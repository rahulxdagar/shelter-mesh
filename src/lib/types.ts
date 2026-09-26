export type AppRole = "outreach" | "shelter_staff" | "ems" | "city_ops" | "observer";
export type FacilityKind = "shelter" | "overflow" | "warming_hub";
export type HoldStatus = "HELD" | "CHECKED_IN" | "EXPIRED" | "CANCELLED";
export type IncidentStatus = "ACTIVE" | "EN_ROUTE" | "ON_SCENE" | "RESOLVED" | "FALSE_ALARM";

export type Profile = {
  id: string;
  full_name: string;
  role: AppRole;
  shelter_id: string | null;
  callsign: string | null;
  operational_radius_km: number;
};

export type Shelter = {
  id: string;
  slug: string;
  name: string;
  operator: string;
  address: string;
  phone: string | null;
  kind: FacilityKind;
  lat: number;
  lng: number;
  demographics_supported: string[];
  min_age: number;
  max_age: number;
  total_beds: number;
  available_beds: number;
  total_chairs: number;
  available_chairs: number;
  is_active: boolean;
  updated_at: string;
};

export type Gender = "man" | "woman" | "trans_man" | "trans_woman" | "non_binary" | "two_spirit";
export type Sobriety = "abstinent" | "using" | "intoxicated";
export type Need = "wheelchair" | "medical" | "pets";

export type Triage = {
  age: number;
  gender: Gender;
  sobriety: Sobriety;
  needs: Need[];
  family: boolean;
};

export type BedHold = {
  id: string;
  shelter_id: string;
  created_by: string;
  referrer: string;
  origin: "outreach" | "walk_in_reroute";
  origin_shelter_id: string | null;
  client_label: string;
  triage: Partial<Triage>;
  status: HoldStatus;
  held_minutes: number;
  expires_at: string;
  parent_hold_id: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type ShelterMatch = Pick<
  Shelter,
  | "id"
  | "slug"
  | "name"
  | "operator"
  | "address"
  | "phone"
  | "kind"
  | "lat"
  | "lng"
  | "available_beds"
  | "total_beds"
  | "demographics_supported"
> & { distance_m: number };

export type Incident = {
  id: string;
  client_ref: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  address: string | null;
  status: IncidentStatus;
  reported_by: string;
  reporter_role: AppRole;
  responder_id: string | null;
  captured_at: string;
  created_at: string;
  updated_at: string;
  queued_offline: boolean;
};

export type SystemState = {
  id: 1;
  code_frost: boolean;
  frost_mode: "auto" | "force_on" | "force_off";
  windchill_threshold_c: number;
  occupancy_threshold_pct: number;
  temperature_c: number | null;
  wind_kmh: number | null;
  windchill_c: number | null;
  network_occupancy_pct: number | null;
  weather_observed_at: string | null;
  last_evaluated_at: string | null;
  last_error: string | null;
  frost_activated_at: string | null;
  warming_hubs_authorized: boolean;
  hubs_authorized_at: string | null;
};

export type Alert = {
  id: number;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  audience: AppRole[];
  created_at: string;
};

export const ROLE_HOME: Record<AppRole, string> = {
  outreach: "/outreach",
  shelter_staff: "/shelter",
  ems: "/ems",
  city_ops: "/ops",
  observer: "/observer",
};

export const ROLE_LABEL: Record<AppRole, string> = {
  outreach: "Street Outreach",
  shelter_staff: "Shelter Intake",
  ems: "EMS Crisis Team",
  city_ops: "City Operations · 3-1-1",
  observer: "Trusted Field Observer",
};

export const GENDER_LABEL: Record<Gender, string> = {
  man: "Man",
  woman: "Woman",
  trans_man: "Trans man",
  trans_woman: "Trans woman",
  non_binary: "Non-binary",
  two_spirit: "Two-Spirit",
};

export const SOBRIETY_LABEL: Record<Sobriety, string> = {
  abstinent: "Sober",
  using: "Using, not intoxicated",
  intoxicated: "Intoxicated now",
};

export const NEED_LABEL: Record<Need, string> = {
  wheelchair: "Wheelchair access",
  medical: "Medical support",
  pets: "Has a pet",
};

export const TAG_LABEL: Record<string, string> = {
  men: "Men",
  women: "Women",
  gender_diverse: "2SLGBTQ+",
  families: "Families",
  low_barrier: "Low-barrier",
  wheelchair: "Accessible",
  medical: "Medical",
  pets: "Pets OK",
};

export const INCIDENT_LABEL: Record<IncidentStatus, string> = {
  ACTIVE: "Active",
  EN_ROUTE: "En route",
  ON_SCENE: "On scene",
  RESOLVED: "Resolved",
  FALSE_ALARM: "False alarm",
};
