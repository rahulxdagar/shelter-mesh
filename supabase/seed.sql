-- Cold-Grid demo seed. Idempotent: re-run to reset the demo to its starting state.
-- Facility names, addresses and coordinates are real; bed/chair counts are demo values tuned so the
-- network sits just under the 99% Code Frost occupancy threshold (a handful of holds tips it over).

-- ─── Facilities ───────────────────────────────────────────────────────────────
insert into public.shelters
  (slug, name, operator, address, phone, kind, location, demographics_supported, min_age, max_age,
   total_beds, available_beds, total_chairs, available_chairs, is_active)
values
  ('ottawa-mission', 'The Ottawa Mission', 'The Ottawa Mission', '35 Waller St, Ottawa, ON K1N 7G4', '613-234-1144', 'shelter',
   'SRID=4326;POINT(-75.6878414 45.4264807)', array['men','low_barrier','medical','wheelchair'], 18, 120, 235, 3, 40, 6, true),
  ('booth-centre', 'Salvation Army Booth Centre', 'The Salvation Army', '171 George St, Ottawa, ON K1N 5W5', '613-241-1573', 'shelter',
   'SRID=4326;POINT(-75.6889893 45.4286590)', array['men','low_barrier'], 18, 120, 94, 1, 20, 2, true),
  ('shepherds-murray', 'Shepherds of Good Hope', 'Shepherds of Good Hope', '233 Murray St, Ottawa, ON K1N 5M9', '613-789-4179', 'shelter',
   'SRID=4326;POINT(-75.6889200 45.4318988)', array['men','women','gender_diverse','low_barrier','medical','wheelchair'], 18, 120, 180, 2, 50, 4, true),
  ('cornerstone', 'Cornerstone Emergency Shelter', 'Cornerstone Housing for Women', '314 Booth St, Ottawa, ON K1R 7K2', '613-254-6584', 'shelter',
   'SRID=4326;POINT(-75.7103322 45.4085895)', array['women','gender_diverse','low_barrier','wheelchair'], 18, 120, 58, 2, 10, 1, true),
  ('ysb-youth', 'YSB Youth Shelter', 'Youth Services Bureau', '147 Besserer St, Ottawa, ON K1N 6A7', '613-907-8975', 'shelter',
   'SRID=4326;POINT(-75.6886690 45.4268948)', array['men','gender_diverse','low_barrier'], 16, 24, 40, 3, 0, 0, true),
  ('carling-family', 'Carling Family Shelter', 'City of Ottawa', '2980 Carling Ave, Ottawa, ON K2B 7Z1', '613-829-3975', 'shelter',
   'SRID=4326;POINT(-75.8039339 45.3552705)', array['families','wheelchair'], 16, 120, 60, 1, 0, 0, true),
  ('bernard-grandmaitre', 'Bernard Grandmaître Respite Centre', 'City of Ottawa', '309 McArthur Ave, Ottawa, ON K1L 6R2', '613-806-7291', 'overflow',
   'SRID=4326;POINT(-75.6554553 45.4328531)', array['men','low_barrier','pets'], 18, 120, 100, 4, 30, 5, true),
  ('tom-brown-arena', 'Tom Brown Arena Warming Hub', 'City of Ottawa', '141 Bayview Station Rd, Ottawa, ON K1Y 4T1', '3-1-1', 'warming_hub',
   'SRID=4326;POINT(-75.7225666 45.4081078)', array['men','women','gender_diverse','families','low_barrier','wheelchair','pets'], 16, 120, 80, 80, 30, 30, false),
  ('routhier-centre', 'Routhier Community Centre Warming Hub', 'City of Ottawa', '172 Guigues Ave, Ottawa, ON K1N 5H9', '3-1-1', 'warming_hub',
   'SRID=4326;POINT(-75.6916059 45.4320568)', array['men','women','gender_diverse','families','low_barrier','wheelchair','pets'], 16, 120, 40, 40, 30, 30, false),
  ('dempsey-centre', 'Dempsey Community Centre Warming Hub', 'City of Ottawa', '1895 Russell Rd, Ottawa, ON K1G 0N1', '3-1-1', 'warming_hub',
   'SRID=4326;POINT(-75.6276651 45.4025858)', array['men','women','gender_diverse','families','low_barrier','wheelchair','pets'], 16, 120, 50, 50, 30, 30, false),
  ('jim-durrell-centre', 'Jim Durrell Recreation Centre Warming Hub', 'City of Ottawa', '1265 Walkley Rd, Ottawa, ON K1V 6P9', '3-1-1', 'warming_hub',
   'SRID=4326;POINT(-75.6588175 45.3730980)', array['men','women','gender_diverse','families','low_barrier','wheelchair','pets'], 16, 120, 60, 60, 30, 30, false)
on conflict (slug) do update set
  name = excluded.name, operator = excluded.operator, address = excluded.address, phone = excluded.phone,
  kind = excluded.kind, location = excluded.location, demographics_supported = excluded.demographics_supported,
  min_age = excluded.min_age, max_age = excluded.max_age,
  total_beds = excluded.total_beds, available_beds = excluded.available_beds,
  total_chairs = excluded.total_chairs, available_chairs = excluded.available_chairs,
  is_active = excluded.is_active, updated_at = now();

-- ─── Reset live state ─────────────────────────────────────────────────────────
delete from public.bed_holds;
delete from public.incidents;
delete from public.alerts;
update public.system_state set
  code_frost = false, frost_mode = 'auto', windchill_threshold_c = -5, occupancy_threshold_pct = 99,
  frost_activated_at = null, warming_hubs_authorized = false, hubs_authorized_by = null, hubs_authorized_at = null,
  last_error = null
where id = 1;

-- ─── Demo accounts (password for all: ColdGrid-2026!) ─────────────────────────
create or replace function private.seed_user(p_email text, p_name text, p_role public.app_role,
                                             p_shelter_slug text, p_callsign text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid;
begin
  select id into uid from auth.users where email = p_email;
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email,
            crypt('ColdGrid-2026!', gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_name),
            now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text,
            jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true),
            'email', now(), now(), now());
  end if;

  insert into public.profiles (id, full_name, role, shelter_id, callsign)
  values (uid, p_name, p_role, (select id from public.shelters where slug = p_shelter_slug), p_callsign)
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role,
    shelter_id = excluded.shelter_id, callsign = excluded.callsign;
end $$;
revoke all on function private.seed_user from public, anon, authenticated;

select private.seed_user('outreach@coldgrid.demo',     'Maya Tremblay',    'outreach',      null, 'OUTREACH-7');
select private.seed_user('outreach2@coldgrid.demo',    'Daniel Okafor',    'outreach',      null, 'OUTREACH-3');
select private.seed_user('ems@coldgrid.demo',          'Sam Gagnon',       'ems',           null, 'MEDIC-12');
select private.seed_user('ems2@coldgrid.demo',         'Priya Nair',       'ems',           null, 'MEDIC-31');
select private.seed_user('ops@coldgrid.demo',          'Louise Chen',      'city_ops',      null, '311-OPS');
select private.seed_user('observer@coldgrid.demo',     'Trusted Observer', 'observer',      null, 'OBS-1');
select private.seed_user('staff.mission@coldgrid.demo',     'Mission Intake Desk',     'shelter_staff', 'ottawa-mission',      'DESK-OM');
select private.seed_user('staff.booth@coldgrid.demo',       'Booth Centre Intake Desk', 'shelter_staff', 'booth-centre',        'DESK-BC');
select private.seed_user('staff.shepherds@coldgrid.demo',   'Shepherds Intake Desk',   'shelter_staff', 'shepherds-murray',    'DESK-SGH');
select private.seed_user('staff.cornerstone@coldgrid.demo', 'Cornerstone Intake Desk', 'shelter_staff', 'cornerstone',         'DESK-CS');
select private.seed_user('staff.ysb@coldgrid.demo',         'YSB Intake Desk',         'shelter_staff', 'ysb-youth',           'DESK-YSB');
select private.seed_user('staff.carling@coldgrid.demo',     'Carling Intake Desk',     'shelter_staff', 'carling-family',      'DESK-CF');
select private.seed_user('staff.respite@coldgrid.demo',     'Respite Centre Desk',     'shelter_staff', 'bernard-grandmaitre', 'DESK-BG');

-- Take a first reading so the dashboards have live weather immediately.
select private.evaluate_code_frost();
