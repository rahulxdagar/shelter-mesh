export type Permission =
  | 'read:capacity'
  | 'write:capacity'
  | 'create:hold'
  | 'confirm:hold'
  | 'create:alert'
  | 'respond:alert'
  | 'execute:code_frost'
  | 'read:audit';

export type Role = 'outreach' | 'responder' | 'shelter_admin' | 'city_ops';

export type Me = { sub: string; name: string; permissions: Permission[]; shelterId: string | null };

export type Shelter = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: 'shelter' | 'overflow';
  capacity: number;
  occupied: number;
  held: number;
  available: number;
  status: 'green' | 'yellow' | 'red';
  updatedAt: string;
};

export type Snapshot = {
  at: string;
  shelters: Shelter[];
  totals: { capacity: number; available: number; availablePct: number; overflowActive: number; overflowAvailable: number };
};

export type Match = Shelter & {
  distanceM: number;
  bestTimeS: number;
  travel: { walkS: number | null; transitS: number | null; distanceM: number; source: 'google' | 'estimate' };
};

export type Hold = { id: string; shelterId: string; shelterName?: string; code: string; createdAt: string; expireAt: string };

export type Incident = {
  id: string;
  status: 'open' | 'claimed' | 'resolved';
  source: 'app' | 'sms';
  lat: number;
  lng: number;
  alertedCount: number;
  claimedBy: string | null;
  claimedByName?: string | null;
  createdAt: string;
  claimedAt: string | null;
  resolvedAt: string | null;
  dispatchMs: number | null;
};

export type IncidentAlert = Incident & { distanceM: number; walkS: number; navigationUrl: string };

export type CodeFrostState = {
  event: {
    id: string;
    status: 'pending_authorization' | 'active' | 'ended';
    triggeredAt: string;
    reason: { availablePct: number; effectiveTempC: number; weatherOverridden: boolean };
    authorizedVia: 'sms' | 'dashboard' | null;
  } | null;
  weather: {
    reading: { tempC: number; windKmh: number; effectiveTempC: number; observedAt: string; station: string } | null;
    overridden: boolean;
    lastError: string | null;
  };
  availablePct: number;
  thresholds: { availablePctBelow: number; effectiveTempBelowC: number; overflowSpaces: number };
  conditions: { capacity: boolean; temperature: boolean };
  oncallCount: number;
};

export type OutboxEntry = {
  id: string;
  channel: 'sms' | 'voice';
  direction: 'out' | 'in';
  to: string;
  from: string;
  body: string;
  at: string;
  status: 'sent' | 'simulated' | 'failed' | 'received';
  error?: string;
};

export type AuditEntry = {
  id: string;
  type: string;
  at: string;
  data: Record<string, unknown>;
  hash: string;
  ledger: { mode: 'hedera' | 'local'; status: string; topicId?: string; sequenceNumber?: string };
};

export type Verification = {
  hashMatches: boolean;
  chainMatches: boolean | null;
  ledger:
    | { mode: 'local' }
    | { mode: 'hedera'; status: string; ledgerMatches: boolean | null; consensusAt: string | null; explorerUrl: string | null };
};

export type PublicConfig = {
  integrations: Record<'database' | 'auth' | 'routing' | 'sms' | 'ledger' | 'weather' | 'history', string>;
  smsNumber: string;
  demoControls: boolean;
};
