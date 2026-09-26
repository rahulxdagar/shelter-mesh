import { after, before, beforeEach } from 'node:test';
import supertest from 'supertest';
import { createApp } from '../src/app.ts';
import { devToken, type Role } from '../src/auth.ts';
import { closeDb, connectDb } from '../src/db.ts';
import { resetDemo } from '../src/seed.ts';

export const tokens = {
  outreach: devToken('outreach', 'outreach-1', 'Sam'),
  outreach2: devToken('outreach', 'outreach-2', 'Kai'),
  responderA: devToken('responder', 'responder-a', 'Riley'),
  responderB: devToken('responder', 'responder-b', 'Jordan'),
  responderFar: devToken('responder', 'responder-far', 'Morgan'),
  shelterAdmin: devToken('shelter_admin', 'admin-hinton', 'Pat', 'hintonburg-respite'),
  ops: devToken('city_ops', 'ops-1', 'Alex'),
};

export function token(role: Role, sub: string, shelterId: string | null = null) {
  return devToken(role, sub, sub, shelterId);
}

export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Each test file runs in its own process with its own in-memory replica set.
export function useTestApp() {
  const ctx = { request: null as unknown as ReturnType<typeof supertest>, app: null as unknown as ReturnType<typeof createApp> };
  before(async () => {
    await connectDb(null, 'coldgrid-test');
    ctx.app = createApp();
    ctx.request = supertest(ctx.app);
  });
  beforeEach(async () => {
    await resetDemo();
  });
  after(async () => {
    await closeDb();
  });
  return ctx;
}
