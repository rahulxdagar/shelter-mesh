import type { ObjectId } from 'mongodb';

export type Point = { type: 'Point'; coordinates: [lng: number, lat: number] };

export type Gender = 'woman' | 'man' | 'nonbinary';

export type Eligibility = {
  minAge: number;
  maxAge: number;
  acceptsGenders: Gender[];
  acceptsFamilies: boolean;
  accessible: boolean;
  allowsActiveUse: boolean;
};

export type ShelterDoc = {
  _id: string;
  name: string;
  address: string;
  location: Point;
  kind: 'shelter' | 'overflow';
  active: boolean;
  capacity: number;
  occupied: number;
  eligibility: Eligibility;
  holdSeq: number; // bumped inside hold transactions so concurrent holds conflict
  isFull: boolean; // last recorded full/not-full state, for exactly-once shelter_full audits
  updatedAt: Date;
};

export type HoldDoc = {
  _id: ObjectId;
  shelterId: string;
  code: string;
  createdBy: string;
  createdAt: Date;
  expireAt: Date;
};

export type PresenceDoc = {
  _id: string; // user sub
  name: string;
  location: Point;
  lastSeen: Date;
};

export type IncidentDoc = {
  _id: ObjectId;
  status: 'open' | 'claimed' | 'resolved';
  source: 'app' | 'sms';
  location: Point;
  reporterId: string;
  alerted: { userId: string; distanceM: number }[];
  claimedBy: string | null;
  claimedByName?: string | null;
  createdAt: Date;
  claimedAt: Date | null;
  resolvedAt: Date | null;
  dispatchMs: number | null;
};

export type AuditType =
  | 'shelter_full'
  | 'code_frost_triggered'
  | 'code_frost_authorized'
  | 'code_frost_ended'
  | 'overdose_alert'
  | 'overdose_claimed'
  | 'overdose_resolved';

export type AuditDoc = {
  _id: ObjectId;
  type: AuditType;
  at: Date;
  data: Record<string, unknown>;
  hash: string;
  prevHash: string | null;
  ledger: {
    mode: 'hedera' | 'local';
    status: 'pending' | 'submitted' | 'local' | 'failed';
    attempts: number;
    topicId?: string;
    sequenceNumber?: string;
    transactionId?: string;
    error?: string;
  };
};

export type CodeFrostDoc = {
  _id: ObjectId;
  open?: true; // present only while pending or active; unique index allows one open event
  status: 'pending_authorization' | 'active' | 'ended';
  triggeredAt: Date;
  reason: { availablePct: number; effectiveTempC: number; weatherOverridden: boolean };
  authorizedAt: Date | null;
  authorizedBy: string | null;
  authorizedVia: 'sms' | 'dashboard' | null;
  endedAt: Date | null;
};

export type OutboxDoc = {
  _id: ObjectId;
  channel: 'sms' | 'voice';
  direction: 'out' | 'in';
  to: string;
  from: string;
  body: string;
  at: Date;
  status: 'sent' | 'simulated' | 'failed' | 'received';
  error?: string;
};

export type WeatherReading = {
  tempC: number;
  windKmh: number;
  effectiveTempC: number;
  observedAt: string;
  station: string;
};

export type SettingsDoc =
  | {
      _id: 'weather';
      latest: WeatherReading | null;
      lastError: string | null;
      fetchedAt: Date | null;
      override: { tempC: number; windKmh: number } | null;
    };
