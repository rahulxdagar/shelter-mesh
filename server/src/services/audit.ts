import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { config } from '../config.ts';
import { col } from '../db.ts';
import { rt } from '../realtime.ts';
import type { AuditDoc, AuditType } from '../types.ts';
import { hederaMessage, submitToHedera } from './hedera.ts';

// Canonical JSON: object keys sorted, Dates as ISO strings. The same event always hashes the same.
export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value instanceof ObjectId) return JSON.stringify(value.toHexString());
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

export function hashEvent(e: Pick<AuditDoc, '_id' | 'type' | 'at' | 'data' | 'prevHash'>): string {
  return createHash('sha256')
    .update(canonicalJson({ id: e._id, type: e.type, at: e.at, data: e.data, prevHash: e.prevHash }))
    .digest('hex');
}

const ledgerMode = (): 'hedera' | 'local' => (config.hedera?.topicId ? 'hedera' : 'local');

// Events are chained (each includes the previous hash). Writes are serialized in-process so the
// chain has no forks. With several API instances, Hedera's ordering is the source of truth.
let chain: Promise<unknown> = Promise.resolve();

export function recordAudit(type: AuditType, data: Record<string, unknown>): Promise<AuditDoc> {
  const next = chain.then(async () => {
    const prev = await col.audit().find({}, { projection: { hash: 1 } }).sort({ at: -1, _id: -1 }).limit(1).next();
    const doc: AuditDoc = {
      _id: new ObjectId(),
      type,
      at: new Date(),
      data,
      prevHash: prev?.hash ?? null,
      hash: '',
      ledger: { mode: ledgerMode(), status: ledgerMode() === 'hedera' ? 'pending' : 'local', attempts: 0 },
    };
    doc.hash = hashEvent(doc);
    await col.audit().insertOne(doc);
    rt.toPermission('read:audit', 'audit', serializeAudit(doc));
    if (doc.ledger.mode === 'hedera') kickLedger();
    return doc;
  });
  chain = next.catch(() => {});
  return next;
}

export function serializeAudit(d: AuditDoc) {
  return { ...d, id: d._id.toHexString(), _id: undefined, at: d.at.toISOString() };
}

// SRS FR 6.4: ledger submission is asynchronous and retried; it never delays a dispatch.
let ledgerBusy = false;
const MAX_ATTEMPTS = 5;

export function kickLedger() {
  if (ledgerBusy || ledgerMode() !== 'hedera') return;
  ledgerBusy = true;
  void drainLedger().finally(() => {
    ledgerBusy = false;
  });
}

async function drainLedger() {
  for (;;) {
    const doc = await col
      .audit()
      .find({ 'ledger.status': 'pending', 'ledger.attempts': { $lt: MAX_ATTEMPTS } })
      .sort({ at: 1 })
      .limit(1)
      .next();
    if (!doc) return;
    try {
      const receipt = await submitToHedera(hederaMessage(doc));
      await col.audit().updateOne(
        { _id: doc._id },
        {
          $set: {
            'ledger.status': 'submitted',
            'ledger.topicId': receipt.topicId,
            'ledger.sequenceNumber': receipt.sequenceNumber,
            'ledger.transactionId': receipt.transactionId,
          },
          $inc: { 'ledger.attempts': 1 },
        },
      );
    } catch (err) {
      const attempts = doc.ledger.attempts + 1;
      await col.audit().updateOne(
        { _id: doc._id },
        {
          $set: {
            'ledger.status': attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            'ledger.error': String((err as Error).message ?? err),
          },
          $inc: { 'ledger.attempts': 1 },
        },
      );
      console.error('[ledger] submit failed', (err as Error).message);
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempts)));
    }
    const updated = await col.audit().findOne({ _id: doc._id });
    if (updated) rt.toPermission('read:audit', 'audit', serializeAudit(updated));
  }
}

export function startLedgerWorker() {
  kickLedger();
  setInterval(kickLedger, 30_000).unref();
}

export type Verification = {
  id: string;
  storedHash: string;
  recomputedHash: string;
  hashMatches: boolean;
  chainMatches: boolean | null; // null for the first event
  ledger:
    | { mode: 'local' }
    | { mode: 'hedera'; status: string; ledgerHash: string | null; ledgerMatches: boolean | null; consensusAt: string | null; explorerUrl: string | null };
};

// SRS FR 6.5
export async function verifyAudit(id: string): Promise<Verification | null> {
  if (!ObjectId.isValid(id)) return null;
  const doc = await col.audit().findOne({ _id: new ObjectId(id) });
  if (!doc) return null;
  const recomputed = hashEvent(doc);
  let chainMatches: boolean | null = null;
  if (doc.prevHash) {
    const prev = await col
      .audit()
      .find({ $or: [{ at: { $lt: doc.at } }, { at: doc.at, _id: { $lt: doc._id } }] })
      .sort({ at: -1, _id: -1 })
      .limit(1)
      .next();
    chainMatches = prev?.hash === doc.prevHash;
  }
  const base = {
    id,
    storedHash: doc.hash,
    recomputedHash: recomputed,
    hashMatches: recomputed === doc.hash,
    chainMatches,
  };
  if (doc.ledger.mode === 'local') return { ...base, ledger: { mode: 'local' } };

  let ledgerHash: string | null = null;
  let consensusAt: string | null = null;
  const { topicId, sequenceNumber } = doc.ledger;
  if (topicId && sequenceNumber) {
    try {
      const res = await fetch(`${config.hederaMirrorUrl}/api/v1/topics/${topicId}/messages/${sequenceNumber}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body = (await res.json()) as { message: string; consensus_timestamp: string };
        const msg = JSON.parse(Buffer.from(body.message, 'base64').toString('utf8')) as { hash?: string };
        ledgerHash = msg.hash ?? null;
        consensusAt = new Date(Number(body.consensus_timestamp.split('.')[0]) * 1000).toISOString();
      }
    } catch (err) {
      console.error('[ledger] mirror lookup failed', (err as Error).message);
    }
  }
  return {
    ...base,
    ledger: {
      mode: 'hedera',
      status: doc.ledger.status,
      ledgerHash,
      ledgerMatches: ledgerHash ? ledgerHash === recomputed : null,
      consensusAt,
      explorerUrl: topicId
        ? `https://hashscan.io/${config.hedera?.network ?? 'testnet'}/topic/${topicId}`
        : null,
    },
  };
}
