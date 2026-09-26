import { randomInt } from 'node:crypto';
import { ObjectId } from 'mongodb';
import type { User } from '../auth.ts';
import { canManageShelter } from '../auth.ts';
import { config } from '../config.ts';
import { col, mongoClient } from '../db.ts';
import { conflict, forbidden, notFound } from '../errors.ts';
import type { HoldDoc } from '../types.ts';
import { availableBeds } from './capacity.ts';

export function serializeHold(h: HoldDoc, shelterName?: string) {
  return {
    id: h._id.toHexString(),
    shelterId: h.shelterId,
    shelterName,
    code: h.code,
    createdAt: h.createdAt.toISOString(),
    expireAt: h.expireAt.toISOString(),
  };
}

function holdCode(): string {
  return `FROST-${randomInt(1000, 10000)}`;
}

// SRS FR 2.5. The first write bumps holdSeq on the shelter, so two concurrent holds on the same
// shelter write-conflict. withTransaction retries the loser, which then re-counts and sees 0 beds.
export async function createHold(user: User, shelterId: string): Promise<HoldDoc> {
  const session = mongoClient().startSession();
  try {
    return await session.withTransaction(async () => {
      const now = new Date();
      const shelter = await col
        .shelters()
        .findOneAndUpdate({ _id: shelterId, active: true }, { $inc: { holdSeq: 1 } }, { session, returnDocument: 'after' });
      if (!shelter) throw notFound('Shelter not found');
      const held = await col.holds().countDocuments({ shelterId, expireAt: { $gt: now } }, { session });
      if (availableBeds(shelter, held) <= 0) throw conflict('No beds available at this shelter');
      const hold: HoldDoc = {
        _id: new ObjectId(),
        shelterId,
        code: holdCode(),
        createdBy: user.sub,
        createdAt: now,
        expireAt: new Date(now.getTime() + config.holdMinutes * 60_000),
      };
      await col.holds().insertOne(hold, { session });
      return hold;
    });
  } finally {
    await session.endSession();
  }
}

async function findActiveHold(id: string): Promise<HoldDoc> {
  if (!ObjectId.isValid(id)) throw notFound('Hold not found');
  const hold = await col.holds().findOne({ _id: new ObjectId(id), expireAt: { $gt: new Date() } });
  if (!hold) throw notFound('Hold not found or expired');
  return hold;
}

// SRS FR 2.7: confirming arrival turns the hold into an occupied bed, atomically.
export async function confirmHold(user: User, id: string): Promise<void> {
  const hold = await findActiveHold(id);
  if (!canManageShelter(user, hold.shelterId)) throw forbidden('Not your shelter');
  const session = mongoClient().startSession();
  try {
    await session.withTransaction(async () => {
      const deleted = await col.holds().findOneAndDelete({ _id: hold._id, expireAt: { $gt: new Date() } }, { session });
      if (!deleted) throw notFound('Hold not found or expired');
      await col
        .shelters()
        .updateOne({ _id: hold.shelterId }, { $inc: { occupied: 1 }, $set: { updatedAt: new Date() } }, { session });
    });
  } finally {
    await session.endSession();
  }
}

export async function cancelHold(user: User, id: string): Promise<void> {
  const hold = await findActiveHold(id);
  if (hold.createdBy !== user.sub) throw forbidden('Only the worker who made the hold can cancel it');
  await col.holds().deleteOne({ _id: hold._id });
}

export async function holdsForShelter(shelterId: string) {
  const holds = await col.holds().find({ shelterId, expireAt: { $gt: new Date() } }).sort({ expireAt: 1 }).toArray();
  return holds.map((h) => serializeHold(h));
}

export async function holdsByUser(sub: string) {
  const holds = await col.holds().find({ createdBy: sub, expireAt: { $gt: new Date() } }).sort({ expireAt: 1 }).toArray();
  const shelters = await col
    .shelters()
    .find({ _id: { $in: holds.map((h) => h.shelterId) } }, { projection: { name: 1 } })
    .toArray();
  const names = new Map(shelters.map((s) => [s._id, s.name]));
  return holds.map((h) => serializeHold(h, names.get(h.shelterId)));
}
