-- Cold-Grid: RPC surface. Every client write goes through one of these functions.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ─── Hold lifecycle ───────────────────────────────────────────────────────────

-- Releases every lapsed hold and restores its bed to public inventory.
-- Called by pg_cron every minute, by every inventory RPC before it reads stock,
-- and by clients the instant a countdown reaches zero, so expiry is effectively exact.
create or replace function public.expire_holds()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  -- Only one expiry sweep at a time; a concurrent caller can skip safely.
  if not pg_try_advisory_xact_lock(hashtext('coldgrid.expire_holds')) then
    return 0;
  end if;

  with expired as (
    update bed_holds
       set status = 'EXPIRED', resolved_at = now()
     where status = 'HELD' and expires_at <= now()
    returning shelter_id
  ), counts as (
    select shelter_id, count(*)::int as c from expired group by shelter_id
  ), restored as (
    update shelters s
       set available_beds = least(s.total_beds, s.available_beds + counts.c),
           updated_at = now()
      from counts
     where s.id = counts.shelter_id
    returning counts.c
  )
  select coalesce(sum(c), 0) into n from restored;
  return n;
end $$;

-- Claims one bed under a pessimistic row lock. Raises OUT_OF_STOCK when the
-- facility has nothing left so the caller can re-query for the next nearest match.
create or replace function private.claim_bed(
  p_shelter uuid, p_minutes int, p_client_label text, p_triage jsonb,
  p_origin text, p_origin_shelter uuid, p_parent uuid
) returns public.bed_holds language plpgsql security definer set search_path = public as $$
declare
  s public.shelters;
  h public.bed_holds;
begin
  select * into s from shelters where id = p_shelter for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002', detail = 'Facility does not exist.';
  end if;
  if not s.is_active then
    raise exception 'FACILITY_CLOSED' using errcode = 'P0001', detail = s.name || ' is not currently open.';
  end if;
  if s.available_beds <= 0 then
    raise exception 'OUT_OF_STOCK' using errcode = 'P0001', detail = s.name || ' has no beds left.';
  end if;

  update shelters set available_beds = available_beds - 1, updated_at = now() where id = p_shelter;

  insert into bed_holds (shelter_id, created_by, referrer, origin, origin_shelter_id, client_label, triage,
                         held_minutes, expires_at, parent_hold_id)
  values (p_shelter, auth.uid(),
          coalesce((select coalesce(callsign, full_name) from profiles where id = auth.uid()), 'Unknown'),
          p_origin, p_origin_shelter, coalesce(nullif(trim(p_client_label), ''), 'Client'),
          coalesce(p_triage, '{}'::jsonb), p_minutes, now() + make_interval(mins => p_minutes), p_parent)
  returning * into h;
  return h;
end $$;
revoke all on function private.claim_bed from public, anon, authenticated;

create or replace function public.hold_bed(p_shelter uuid, p_client_label text, p_triage jsonb)
returns public.bed_holds language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['outreach', 'shelter_staff', 'city_ops']::app_role[]);
  perform expire_holds();
  return private.claim_bed(p_shelter, 20, p_client_label, p_triage, 'outreach', null, null);
end $$;

-- One-tap re-lock after a hold lapsed in transit: another 10 minutes if stock remains.
create or replace function public.rehold_bed(p_hold uuid)
returns public.bed_holds language plpgsql security definer set search_path = public as $$
declare old public.bed_holds;
begin
  perform require_role(array['outreach', 'shelter_staff', 'city_ops']::app_role[]);
  perform expire_holds();
  select * into old from bed_holds where id = p_hold for update;
  if not found or (old.created_by <> auth.uid() and current_role_of() <> 'city_ops') then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if old.status <> 'EXPIRED' then
    raise exception 'HOLD_NOT_EXPIRED' using errcode = 'P0001', detail = 'Only an expired hold can be re-held.';
  end if;
  if exists (select 1 from bed_holds where parent_hold_id = p_hold) then
    raise exception 'ALREADY_REHELD' using errcode = 'P0001', detail = 'This reservation was already re-held.';
  end if;
  return private.claim_bed(old.shelter_id, 10, old.client_label, old.triage, old.origin, old.origin_shelter_id, old.id);
end $$;

create or replace function public.check_in_hold(p_hold uuid)
returns public.bed_holds language plpgsql security definer set search_path = public as $$
declare h public.bed_holds; r app_role;
begin
  r := require_role(array['shelter_staff', 'city_ops']::app_role[]);
  perform expire_holds();
  select * into h from bed_holds where id = p_hold for update;
  if not found or (r = 'shelter_staff' and h.shelter_id <> current_shelter_of()) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if h.status = 'EXPIRED' then
    raise exception 'HOLD_EXPIRED' using errcode = 'P0001', detail = 'The 20-minute hold lapsed; the bed returned to public inventory.';
  end if;
  if h.status <> 'HELD' then
    raise exception 'HOLD_NOT_ACTIVE' using errcode = 'P0001', detail = 'This hold is already ' || lower(h.status::text) || '.';
  end if;
  update bed_holds set status = 'CHECKED_IN', resolved_at = now(), resolved_by = auth.uid()
   where id = p_hold returning * into h;
  return h;
end $$;

create or replace function public.cancel_hold(p_hold uuid)
returns public.bed_holds language plpgsql security definer set search_path = public as $$
declare h public.bed_holds; r app_role;
begin
  r := require_role(array['outreach', 'shelter_staff', 'city_ops']::app_role[]);
  perform expire_holds();
  select * into h from bed_holds where id = p_hold for update;
  if not found
     or (r = 'outreach' and h.created_by <> auth.uid())
     or (r = 'shelter_staff' and h.shelter_id <> current_shelter_of() and h.created_by <> auth.uid()) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if h.status <> 'HELD' then
    raise exception 'HOLD_NOT_ACTIVE' using errcode = 'P0001', detail = 'This hold is already ' || lower(h.status::text) || '.';
  end if;
  update shelters set available_beds = least(total_beds, available_beds + 1), updated_at = now()
   where id = h.shelter_id;
  update bed_holds set status = 'CANCELLED', resolved_at = now(), resolved_by = auth.uid()
   where id = p_hold returning * into h;
  return h;
end $$;

-- ─── Matching ─────────────────────────────────────────────────────────────────
-- Gender identity → the facility tag that must be present to serve that person.
-- Trans men and trans women are served by men's and women's facilities respectively;
-- non-binary and Two-Spirit clients match facilities that explicitly welcome gender-diverse guests.
create or replace function private.gender_tags(p_gender text)
returns text[] language sql immutable as $$
  select case p_gender
    when 'man'         then array['men']
    when 'trans_man'   then array['men']
    when 'woman'       then array['women']
    when 'trans_woman' then array['women']
    else                    array['gender_diverse']
  end
$$;

create or replace function public.match_shelters(
  p_lat double precision, p_lng double precision,
  p_age int, p_gender text, p_sobriety text,
  p_needs text[] default '{}', p_family boolean default false,
  p_exclude uuid default null, p_limit int default 5
) returns table (
  id uuid, slug text, name text, operator text, address text, phone text, kind facility_kind,
  lat double precision, lng double precision, available_beds int, total_beds int,
  demographics_supported text[], distance_m double precision
) language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare origin geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
begin
  perform require_role(array['outreach', 'shelter_staff', 'city_ops']::app_role[]);
  perform expire_holds();
  return query
    select s.id, s.slug, s.name, s.operator, s.address, s.phone, s.kind, s.lat, s.lng,
           s.available_beds, s.total_beds, s.demographics_supported,
           st_distance(s.location, origin) as distance_m
      from shelters s
     where s.is_active
       and s.available_beds > 0
       and (p_exclude is null or s.id <> p_exclude)
       and p_age between s.min_age and s.max_age
       and (case when p_family then 'families' = any (s.demographics_supported)
                 else s.demographics_supported && private.gender_tags(p_gender) end)
       and (p_sobriety = 'abstinent' or 'low_barrier' = any (s.demographics_supported))
       and coalesce(p_needs, '{}') <@ s.demographics_supported
     order by distance_m asc
     limit greatest(1, least(p_limit, 20));
end $$;

-- ─── Shelter desk ─────────────────────────────────────────────────────────────
create or replace function public.adjust_inventory(p_shelter uuid, p_resource text, p_delta int)
returns public.shelters language plpgsql security definer set search_path = public as $$
declare r app_role; s public.shelters;
begin
  r := require_role(array['shelter_staff', 'city_ops']::app_role[]);
  if r = 'shelter_staff' and p_shelter <> current_shelter_of() then
    raise exception 'FORBIDDEN' using errcode = '42501', detail = 'You can only adjust your own facility.';
  end if;
  if p_delta = 0 or abs(p_delta) > 25 then
    raise exception 'INVALID_DELTA' using errcode = '22023';
  end if;
  select * into s from shelters where id = p_shelter for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  if p_resource = 'beds' then
    if s.available_beds + p_delta < 0 or s.available_beds + p_delta > s.total_beds then
      raise exception 'OUT_OF_RANGE' using errcode = 'P0001',
        detail = 'Available beds must stay between 0 and ' || s.total_beds || '.';
    end if;
    update shelters set available_beds = available_beds + p_delta, updated_at = now()
     where id = p_shelter returning * into s;
  elsif p_resource = 'chairs' then
    if s.available_chairs + p_delta < 0 or s.available_chairs + p_delta > s.total_chairs then
      raise exception 'OUT_OF_RANGE' using errcode = 'P0001',
        detail = 'Available chairs must stay between 0 and ' || s.total_chairs || '.';
    end if;
    update shelters set available_chairs = available_chairs + p_delta, updated_at = now()
     where id = p_shelter returning * into s;
  else
    raise exception 'INVALID_RESOURCE' using errcode = '22023';
  end if;
  return s;
end $$;

-- Walk-in at a full facility: find the nearest compatible partner and soft-lock a bed there.
-- Retries down the ranked list if a partner's last bed is taken mid-flight.
create or replace function public.reroute_walk_in(p_client_label text, p_triage jsonb)
returns public.bed_holds language plpgsql security definer set search_path = public as $$
declare
  home public.shelters;
  m record;
  h public.bed_holds;
begin
  perform require_role(array['shelter_staff']::app_role[]);
  select * into home from shelters where id = current_shelter_of();

  for m in
    select * from public.match_shelters(
      home.lat, home.lng,
      (p_triage ->> 'age')::int,
      p_triage ->> 'gender',
      coalesce(p_triage ->> 'sobriety', 'abstinent'),
      coalesce(array(select jsonb_array_elements_text(p_triage -> 'needs')), '{}'),
      coalesce((p_triage ->> 'family')::boolean, false),
      home.id, 10)
  loop
    begin
      h := private.claim_bed(m.id, 20, p_client_label, p_triage, 'walk_in_reroute', home.id, null);
      return h;
    exception when others then
      if sqlerrm = 'OUT_OF_STOCK' then continue; end if;
      raise;
    end;
  end loop;

  raise exception 'NO_MATCH' using errcode = 'P0001',
    detail = 'No partner facility has a compatible bed available right now.';
end $$;

-- ─── Overdose incidents ───────────────────────────────────────────────────────
create or replace function public.create_incident(
  p_client_ref uuid, p_lat double precision, p_lng double precision,
  p_accuracy double precision, p_captured_at timestamptz, p_queued boolean default false
) returns public.incidents language plpgsql security definer set search_path = public, extensions as $$
declare r app_role; i public.incidents;
begin
  r := require_role(array['outreach', 'observer', 'shelter_staff', 'ems', 'city_ops']::app_role[]);
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'INVALID_COORDINATES' using errcode = '22023';
  end if;

  insert into incidents (client_ref, location, lat, lng, accuracy_m, reported_by, reporter_role, captured_at, queued_offline)
  values (p_client_ref, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_lat, p_lng, p_accuracy,
          auth.uid(), r, least(coalesce(p_captured_at, now()), now()), coalesce(p_queued, false))
  on conflict (client_ref) do nothing
  returning * into i;

  if i.id is null then
    -- Replay of an already-delivered pin (offline queue retry): return the original.
    select * into i from incidents where client_ref = p_client_ref;
    return i;
  end if;

  insert into incident_events (incident_id, status, actor) values (i.id, 'ACTIVE', auth.uid());
  return i;
end $$;

create or replace function public.set_incident_status(p_incident uuid, p_status incident_status)
returns public.incidents language plpgsql security definer set search_path = public as $$
declare i public.incidents;
begin
  perform require_role(array['ems', 'city_ops']::app_role[]);
  select * into i from incidents where id = p_incident for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if i.status in ('RESOLVED', 'FALSE_ALARM') then
    raise exception 'INCIDENT_CLOSED' using errcode = 'P0001',
      detail = 'Incident already closed as ' || i.status || '.';
  end if;
  if p_status = 'ACTIVE' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  update incidents
     set status = p_status,
         responder_id = case when p_status in ('EN_ROUTE', 'ON_SCENE') then auth.uid() else responder_id end,
         updated_at = now()
   where id = p_incident returning * into i;
  insert into incident_events (incident_id, status, actor) values (i.id, p_status, auth.uid());
  return i;
end $$;

create or replace function public.set_incident_address(p_incident uuid, p_address text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['ems', 'city_ops']::app_role[]);
  update incidents set address = left(p_address, 300) where id = p_incident and address is null;
end $$;

-- ─── Code Frost ───────────────────────────────────────────────────────────────
create or replace function private.windchill(t numeric, v numeric)
returns numeric language sql immutable as $$
  -- Environment and Climate Change Canada wind chill index (T in °C, V in km/h at 10 m).
  select case
    when t is null then null
    when v is null or t > 10 or v < 4.8 then t
    else round((13.12 + 0.6215 * t - 11.37 * power(v, 0.16) + 0.3965 * t * power(v, 0.16))::numeric, 1)
  end
$$;

create or replace function private.evaluate_code_frost()
returns public.system_state language plpgsql security definer set search_path = public, extensions as $$
declare
  st public.system_state;
  resp extensions.http_response;
  body jsonb;
  t numeric; v numeric; wc numeric; occ numeric;
  auto_on boolean; next_on boolean; was_on boolean; err text := null;
begin
  select * into st from system_state where id = 1 for update;
  was_on := st.code_frost;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '8');
    resp := extensions.http_get(
      'https://api.open-meteo.com/v1/forecast?latitude=45.4215&longitude=-75.6972'
      || '&current=temperature_2m,wind_speed_10m&wind_speed_unit=kmh&timezone=America%2FToronto');
    if resp.status <> 200 then
      err := 'Open-Meteo HTTP ' || resp.status;
    else
      body := resp.content::jsonb;
      t := (body -> 'current' ->> 'temperature_2m')::numeric;
      v := (body -> 'current' ->> 'wind_speed_10m')::numeric;
      wc := private.windchill(t, v);
    end if;
  exception when others then
    err := 'Weather fetch failed: ' || sqlerrm;
  end;

  if err is not null then
    -- Keep the last good observation so a flaky upstream never flips the alert.
    t := st.temperature_c; v := st.wind_kmh; wc := st.windchill_c;
  end if;

  select round(100.0 * sum(total_beds - available_beds) / nullif(sum(total_beds), 0), 1)
    into occ from shelters where is_active and kind in ('shelter', 'overflow');

  auto_on := wc is not null and wc <= st.windchill_threshold_c and occ >= st.occupancy_threshold_pct;
  next_on := case st.frost_mode when 'force_on' then true when 'force_off' then false else auto_on end;

  update system_state set
    temperature_c = t, wind_kmh = v, windchill_c = wc,
    network_occupancy_pct = occ,
    weather_observed_at = case when err is null then now() else weather_observed_at end,
    last_evaluated_at = now(),
    last_error = err,
    code_frost = next_on,
    frost_activated_at = case when next_on and not was_on then now()
                              when not next_on then null else frost_activated_at end
  where id = 1 returning * into st;

  if next_on and not was_on then
    insert into alerts (kind, severity, title, body, audience) values (
      'code_frost', 'critical', 'CODE FROST ACTIVATED',
      format('Wind chill %s°C with network occupancy at %s%%. Warming hub authorization required.',
             coalesce(wc::text, '—'), coalesce(occ::text, '—')),
      array['city_ops', 'outreach', 'shelter_staff', 'ems']::app_role[]);
  elsif was_on and not next_on then
    insert into alerts (kind, severity, title, body, audience) values (
      'code_frost_lifted', 'info', 'Code Frost lifted',
      'Conditions are back above thresholds. Standard operations resume.',
      array['city_ops', 'outreach', 'shelter_staff', 'ems']::app_role[]);
  end if;

  return st;
end $$;
revoke all on function private.evaluate_code_frost from public, anon, authenticated;

create or replace function public.refresh_code_frost()
returns public.system_state language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['city_ops']::app_role[]);
  return private.evaluate_code_frost();
end $$;

create or replace function public.set_frost_mode(p_mode text)
returns public.system_state language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['city_ops']::app_role[]);
  if p_mode not in ('auto', 'force_on', 'force_off') then
    raise exception 'INVALID_MODE' using errcode = '22023';
  end if;
  update system_state set frost_mode = p_mode where id = 1;
  return private.evaluate_code_frost();
end $$;

create or replace function public.authorize_warming_hubs(p_authorize boolean)
returns public.system_state language plpgsql security definer set search_path = public as $$
declare st public.system_state; n int;
begin
  perform require_role(array['city_ops']::app_role[]);
  select * into st from system_state where id = 1 for update;
  if p_authorize and not st.code_frost then
    raise exception 'FROST_INACTIVE' using errcode = 'P0001',
      detail = 'Warming hubs can only be unlocked while Code Frost is active.';
  end if;

  update shelters set is_active = p_authorize, updated_at = now() where kind = 'warming_hub';
  get diagnostics n = row_count;

  update system_state set
    warming_hubs_authorized = p_authorize,
    hubs_authorized_by = case when p_authorize then auth.uid() else null end,
    hubs_authorized_at = case when p_authorize then now() else null end
  where id = 1 returning * into st;

  insert into alerts (kind, severity, title, body, audience) values (
    case when p_authorize then 'hubs_open' else 'hubs_closed' end,
    case when p_authorize then 'warning' else 'info' end,
    case when p_authorize then 'Emergency warming hubs OPEN' else 'Emergency warming hubs closed' end,
    case when p_authorize then n || ' municipal warming hubs are now accepting clients and appear in triage matches.'
         else 'Municipal warming hubs are no longer accepting new clients.' end,
    array['city_ops', 'outreach', 'shelter_staff', 'ems']::app_role[]);
  return st;
end $$;

-- ─── Exposure ─────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'expire_holds()', 'hold_bed(uuid,text,jsonb)', 'rehold_bed(uuid)', 'check_in_hold(uuid)', 'cancel_hold(uuid)',
    'match_shelters(double precision,double precision,int,text,text,text[],boolean,uuid,int)',
    'adjust_inventory(uuid,text,int)', 'reroute_walk_in(text,jsonb)',
    'create_incident(uuid,double precision,double precision,double precision,timestamptz,boolean)',
    'set_incident_status(uuid,incident_status)', 'set_incident_address(uuid,text)',
    'refresh_code_frost()', 'set_frost_mode(text)', 'authorize_warming_hubs(boolean)',
    'current_role_of()', 'current_shelter_of()', 'require_role(app_role[])'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;

-- ─── Schedules ────────────────────────────────────────────────────────────────
select cron.schedule('coldgrid-code-frost', '*/15 * * * *', $$select private.evaluate_code_frost()$$);
select cron.schedule('coldgrid-expire-holds', '* * * * *', $$select public.expire_holds()$$);
