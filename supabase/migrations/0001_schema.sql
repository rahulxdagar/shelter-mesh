-- Cold-Grid Shelter Triage Mesh: core schema.
-- All mutations go through SECURITY DEFINER functions; tables are read-only to clients via RLS.

create extension if not exists postgis with schema extensions;
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

-- ─── Enums ────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.app_role as enum ('outreach', 'shelter_staff', 'ems', 'city_ops', 'observer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.facility_kind as enum ('shelter', 'overflow', 'warming_hub');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.hold_status as enum ('HELD', 'CHECKED_IN', 'EXPIRED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.incident_status as enum ('ACTIVE', 'EN_ROUTE', 'ON_SCENE', 'RESOLVED', 'FALSE_ALARM');
exception when duplicate_object then null; end $$;

-- ─── Facilities ───────────────────────────────────────────────────────────────
-- demographics_supported vocabulary:
--   gender:  men | women | gender_diverse
--   group:   families
--   access:  low_barrier (sobriety not required) | wheelchair | medical | pets
create table if not exists public.shelters (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text unique not null,
  name                   text not null,
  operator               text not null,
  address                text not null,
  phone                  text,
  kind                   public.facility_kind not null default 'shelter',
  location               extensions.geography(point, 4326) not null,
  lat                    double precision generated always as (extensions.st_y(location::extensions.geometry)) stored,
  lng                    double precision generated always as (extensions.st_x(location::extensions.geometry)) stored,
  demographics_supported text[] not null default '{}',
  min_age                int not null default 18,
  max_age                int not null default 120,
  total_beds             int not null check (total_beds >= 0),
  available_beds         int not null check (available_beds >= 0),
  total_chairs           int not null default 0 check (total_chairs >= 0),
  available_chairs       int not null default 0 check (available_chairs >= 0),
  is_active              boolean not null default true,
  updated_at             timestamptz not null default now(),
  constraint beds_within_total  check (available_beds <= total_beds),
  constraint chairs_within_total check (available_chairs <= total_chairs)
);
create index if not exists shelters_location_idx on public.shelters using gist (location);

-- ─── Profiles ─────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  full_name          text not null,
  role               public.app_role not null,
  shelter_id         uuid references public.shelters (id),
  callsign           text,
  operational_radius_km numeric not null default 25,
  created_at         timestamptz not null default now(),
  constraint staff_has_shelter check (role <> 'shelter_staff' or shelter_id is not null)
);

-- ─── Bed holds ────────────────────────────────────────────────────────────────
create table if not exists public.bed_holds (
  id              uuid primary key default gen_random_uuid(),
  shelter_id      uuid not null references public.shelters (id),
  created_by      uuid not null references auth.users (id),
  referrer        text not null default 'Unknown',
  origin          text not null default 'outreach' check (origin in ('outreach', 'walk_in_reroute')),
  origin_shelter_id uuid references public.shelters (id),
  client_label    text not null,
  triage          jsonb not null default '{}',
  status          public.hold_status not null default 'HELD',
  held_minutes    int not null,
  expires_at      timestamptz not null,
  parent_hold_id  uuid references public.bed_holds (id),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users (id)
);
create index if not exists bed_holds_active_idx on public.bed_holds (status, expires_at) where status = 'HELD';
create index if not exists bed_holds_shelter_idx on public.bed_holds (shelter_id, created_at desc);
create index if not exists bed_holds_creator_idx on public.bed_holds (created_by, created_at desc);

-- ─── Overdose incidents ───────────────────────────────────────────────────────
create table if not exists public.incidents (
  id            uuid primary key default gen_random_uuid(),
  client_ref    uuid unique not null,           -- idempotency key for offline replay
  location      extensions.geography(point, 4326) not null,
  lat           double precision not null,
  lng           double precision not null,
  accuracy_m    double precision,
  address       text,
  status        public.incident_status not null default 'ACTIVE',
  reported_by   uuid not null references auth.users (id),
  reporter_role public.app_role not null,
  responder_id  uuid references auth.users (id),
  captured_at   timestamptz not null,           -- when the pin was pressed (may predate sync)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  queued_offline boolean not null default false
);
create index if not exists incidents_status_idx on public.incidents (status, created_at desc);

create table if not exists public.incident_events (
  id          bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents (id) on delete cascade,
  status      public.incident_status not null,
  actor       uuid references auth.users (id),
  created_at  timestamptz not null default now()
);

-- ─── Municipal state (singleton) ──────────────────────────────────────────────
create table if not exists public.system_state (
  id                        int primary key default 1 check (id = 1),
  code_frost                boolean not null default false,
  frost_mode                text not null default 'auto' check (frost_mode in ('auto', 'force_on', 'force_off')),
  windchill_threshold_c     numeric not null default -5,
  occupancy_threshold_pct   numeric not null default 99,
  temperature_c             numeric,
  wind_kmh                  numeric,
  windchill_c               numeric,
  network_occupancy_pct     numeric,
  weather_observed_at       timestamptz,
  last_evaluated_at         timestamptz,
  last_error                text,
  frost_activated_at        timestamptz,
  warming_hubs_authorized   boolean not null default false,
  hubs_authorized_by        uuid references auth.users (id),
  hubs_authorized_at        timestamptz
);
insert into public.system_state (id) values (1) on conflict do nothing;

-- ─── Alert feed ───────────────────────────────────────────────────────────────
create table if not exists public.alerts (
  id         bigint generated always as identity primary key,
  kind       text not null,
  severity   text not null check (severity in ('info', 'warning', 'critical')),
  title      text not null,
  body       text not null,
  audience   public.app_role[] not null,
  created_at timestamptz not null default now()
);
create index if not exists alerts_created_idx on public.alerts (created_at desc);

-- ─── Helpers ──────────────────────────────────────────────────────────────────
create or replace function public.current_role_of()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_shelter_of()
returns uuid language sql stable security definer set search_path = public as $$
  select shelter_id from public.profiles where id = auth.uid()
$$;

create or replace function public.require_role(allowed public.app_role[])
returns public.app_role language plpgsql stable security definer set search_path = public as $$
declare r public.app_role;
begin
  r := public.current_role_of();
  if r is null or not (r = any (allowed)) then
    raise exception 'FORBIDDEN' using errcode = '42501', detail = 'Your role cannot perform this action.';
  end if;
  return r;
end $$;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table public.shelters        enable row level security;
alter table public.profiles        enable row level security;
alter table public.bed_holds       enable row level security;
alter table public.incidents       enable row level security;
alter table public.incident_events enable row level security;
alter table public.system_state    enable row level security;
alter table public.alerts          enable row level security;

drop policy if exists shelters_read on public.shelters;
create policy shelters_read on public.shelters for select to authenticated using (true);

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_role_of() in ('city_ops', 'ems'));

drop policy if exists holds_read on public.bed_holds;
create policy holds_read on public.bed_holds for select to authenticated using (
  created_by = auth.uid()
  or public.current_role_of() = 'city_ops'
  or (public.current_role_of() = 'shelter_staff'
      and (shelter_id = public.current_shelter_of() or origin_shelter_id = public.current_shelter_of()))
);

drop policy if exists incidents_read on public.incidents;
create policy incidents_read on public.incidents for select to authenticated using (
  reported_by = auth.uid() or public.current_role_of() in ('ems', 'city_ops')
);

drop policy if exists incident_events_read on public.incident_events;
create policy incident_events_read on public.incident_events for select to authenticated using (
  public.current_role_of() in ('ems', 'city_ops')
);

drop policy if exists state_read on public.system_state;
create policy state_read on public.system_state for select to authenticated using (true);

drop policy if exists alerts_read on public.alerts;
create policy alerts_read on public.alerts for select to authenticated using (public.current_role_of() = any (audience));

-- ─── Realtime ─────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['shelters', 'bed_holds', 'incidents', 'system_state', 'alerts'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

alter table public.bed_holds replica identity full;
alter table public.incidents replica identity full;
