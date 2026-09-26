import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { verifyToken, type User } from './auth.ts';
import { config } from './config.ts';
import { col } from './db.ts';
import { computeSnapshot, recordFullTransitions, type Snapshot } from './services/capacity.ts';

let io: Server | null = null;
let lastSnapshot: Snapshot | null = null;
let stopped = false;
const streams: { close: () => Promise<void> }[] = [];
const timers: NodeJS.Timeout[] = [];

// Services call these; they are no-ops until the Socket.IO server starts (e.g. in tests).
export const rt = {
  toUser(sub: string, event: string, payload: unknown) {
    io?.to(`user:${sub}`).emit(event, payload);
  },
  toPermission(permission: string, event: string, payload: unknown) {
    io?.to(`perm:${permission}`).emit(event, payload);
  },
  toAll(event: string, payload: unknown) {
    io?.to('authed').emit(event, payload);
  },
  snapshotSoon,
};

let pending: NodeJS.Timeout | null = null;
let running = false;
let rerun = false;

// Debounced: a burst of changes produces one snapshot broadcast.
function snapshotSoon() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    void broadcastSnapshot();
  }, 150);
}

async function broadcastSnapshot() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    const snap = await computeSnapshot();
    lastSnapshot = snap;
    io?.to('perm:read:capacity').emit('snapshot', snap);
    await recordFullTransitions(snap);
  } catch (err) {
    console.error('[realtime] snapshot failed', err);
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      snapshotSoon();
    }
  }
}

const locationSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

function onConnection(socket: Socket) {
  const user = socket.data.user as User;
  void socket.join(['authed', `user:${user.sub}`, ...user.permissions.map((p) => `perm:${p}`)]);
  if (lastSnapshot && user.permissions.includes('read:capacity')) socket.emit('snapshot', lastSnapshot);
  else snapshotSoon();

  // SRS FR 4.1: on-duty responders send their position every 30 s. Presence expires via TTL.
  socket.on('presence:update', async (raw: unknown, ack?: (r: unknown) => void) => {
    if (!user.permissions.includes('respond:alert')) return ack?.({ ok: false, error: 'Requires respond:alert' });
    const parsed = locationSchema.safeParse(raw);
    if (!parsed.success) return ack?.({ ok: false, error: 'Invalid location' });
    await col.presence().updateOne(
      { _id: user.sub },
      {
        $set: {
          name: user.name,
          location: { type: 'Point', coordinates: [parsed.data.lng, parsed.data.lat] },
          lastSeen: new Date(),
        },
      },
      { upsert: true },
    );
    ack?.({ ok: true });
  });

  socket.on('presence:off', async (_raw: unknown, ack?: (r: unknown) => void) => {
    await col.presence().deleteOne({ _id: user.sub });
    ack?.({ ok: true });
  });
}

// Restarts a change stream if it errors (e.g. a transient Atlas failover).
function watchCollection(name: string, watch: () => { on: Function; close: () => Promise<void> }) {
  const start = () => {
    if (stopped) return;
    const stream = watch();
    streams.push(stream);
    stream.on('change', () => snapshotSoon());
    stream.on('error', (err: unknown) => {
      if (stopped) return;
      console.error(`[realtime] change stream on ${name} failed, restarting`, err);
      void stream.close().catch(() => {});
      setTimeout(start, 2000).unref();
    });
  };
  start();
}

export function startRealtime(server: HttpServer): Server {
  stopped = false;
  io = new Server(server, {
    cors: { origin: config.corsOrigins.length ? config.corsOrigins : true },
  });

  io.use(async (socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token ?? '');
      socket.data.user = await verifyToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', onConnection);

  // SRS FR 1.4: capacity changes flow MongoDB -> change stream -> WebSocket.
  watchCollection('shelters', () => col.shelters().watch([], { fullDocument: 'default' }));
  watchCollection('holds', () => col.holds().watch([], { fullDocument: 'default' }));

  // Holds stop counting at expireAt, which produces no database change. This sweep catches them.
  let lastSweep = new Date();
  const sweep = setInterval(async () => {
    const now = new Date();
    const expired = await col.holds().countDocuments({ expireAt: { $gt: lastSweep, $lte: now } }).catch(() => 0);
    lastSweep = now;
    if (expired > 0) snapshotSoon();
  }, 5000);
  sweep.unref();
  timers.push(sweep);

  snapshotSoon();
  return io;
}

export async function stopRealtime(): Promise<void> {
  stopped = true;
  timers.splice(0).forEach(clearInterval);
  if (pending) clearTimeout(pending);
  pending = null;
  await Promise.all(streams.splice(0).map((s) => s.close().catch(() => {})));
  await new Promise<void>((resolve) => (io ? io.close(() => resolve()) : resolve()));
  io = null;
  lastSnapshot = null;
}
