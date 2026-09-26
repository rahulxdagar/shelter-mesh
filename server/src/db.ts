import { MongoClient, type Db } from 'mongodb';
import { config } from './config.ts';
import type {
  AuditDoc,
  CodeFrostDoc,
  HoldDoc,
  IncidentDoc,
  OutboxDoc,
  PresenceDoc,
  SettingsDoc,
  ShelterDoc,
} from './types.ts';

let client: MongoClient | null = null;
let database: Db | null = null;
let stopMemoryServer: (() => Promise<unknown>) | null = null;

export function db(): Db {
  if (!database) throw new Error('Database not connected');
  return database;
}

export function mongoClient(): MongoClient {
  if (!client) throw new Error('Database not connected');
  return client;
}

export const col = {
  shelters: () => db().collection<ShelterDoc>('shelters'),
  holds: () => db().collection<HoldDoc>('holds'),
  presence: () => db().collection<PresenceDoc>('presence'),
  incidents: () => db().collection<IncidentDoc>('incidents'),
  audit: () => db().collection<AuditDoc>('audit'),
  codeFrost: () => db().collection<CodeFrostDoc>('codefrost'),
  outbox: () => db().collection<OutboxDoc>('outbox'),
  settings: () => db().collection<SettingsDoc>('settings'),
};

// Connects to MONGODB_URI, or starts an in-memory replica set (change streams and
// transactions need a replica set) when no URI is configured.
export async function connectDb(uri = config.mongodbUri, dbName = config.dbName): Promise<void> {
  let target = uri;
  if (!target) {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    stopMemoryServer = () => rs.stop();
    target = rs.getUri();
    console.log('[db] no MONGODB_URI set, using in-memory replica set');
  }
  client = new MongoClient(target);
  await client.connect();
  database = client.db(dbName);
  await ensureIndexes();
}

export async function closeDb(): Promise<void> {
  await client?.close();
  await stopMemoryServer?.();
  client = null;
  database = null;
  stopMemoryServer = null;
}

async function ensureIndexes(): Promise<void> {
  await Promise.all([
    col.shelters().createIndex({ location: '2dsphere' }),
    col.holds().createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
    col.holds().createIndex({ shelterId: 1, expireAt: 1 }),
    col.holds().createIndex({ createdBy: 1, expireAt: 1 }),
    col.presence().createIndex({ location: '2dsphere' }),
    col.presence().createIndex({ lastSeen: 1 }, { expireAfterSeconds: config.presenceTtlS }),
    col.incidents().createIndex({ status: 1, createdAt: -1 }),
    col.incidents().createIndex({ 'alerted.userId': 1, status: 1 }),
    col.audit().createIndex({ at: -1 }),
    col.audit().createIndex({ 'ledger.status': 1 }),
    col.codeFrost().createIndex({ open: 1 }, { unique: true, partialFilterExpression: { open: true } }),
    col.outbox().createIndex({ at: -1 }),
  ]);
}
