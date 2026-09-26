import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticate, canManageShelter, currentUser, requirePermission } from './auth.ts';
import { config, integrationStatus } from './config.ts';
import { col } from './db.ts';
import { HttpError, badRequest, forbidden, notFound } from './errors.ts';
import { serializeAudit, verifyAudit } from './services/audit.ts';
import { computeSnapshot } from './services/capacity.ts';
import { authorizeCodeFrost, codeFrostState, endCodeFrost, evaluateCodeFrost } from './services/codefrost.ts';
import { cancelHold, confirmHold, createHold, holdsByUser, holdsForShelter, serializeHold } from './services/holds.ts';
import {
  acceptIncident,
  createIncident,
  getIncidentFor,
  openAlertsFor,
  recentIncidents,
  resolveIncident,
} from './services/incidents.ts';
import { backfillSimulated, cityHistory, clearSimulated, historyStatus, incidentHistory, shelterHistory } from './services/history.ts';
import { findMatches, triageSchema } from './services/matching.ts';
import { isValidWebhook, logInbound, recentOutbox, smsNumber, twimlMessage } from './services/twilio.ts';
import { setWeatherOverride } from './services/weather.ts';
import { resetDemo, surgeDemo } from './seed.ts';

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : true }));
  app.use(express.json({ limit: '100kb' }));

  // ---- Public ---------------------------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/public-config', (_req, res) => {
    res.json({ integrations: integrationStatus(), smsNumber: smsNumber(), demoControls: config.demoControls });
  });

  // ---- Twilio webhook (signature-checked, not JWT) ---------------------------------------------
  app.post('/api/twilio/sms', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
    const params = req.body as Record<string, string>;
    const url = `${config.publicApiUrl || `${req.protocol}://${req.get('host')}`}${req.originalUrl}`;
    if (!isValidWebhook(req.get('X-Twilio-Signature'), url, params)) {
      res.status(403).type('text/plain').send('Invalid signature');
      return;
    }
    const from = String(params.From ?? '');
    const body = String(params.Body ?? '').trim();
    await logInbound(from, body);
    let reply: string;

    const od = body.match(/^OD\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (/^AUTHORIZE$/i.test(body)) {
      if (!config.oncallNumbers.includes(from)) reply = 'This number is not on the Code Frost on-call list.';
      else {
        const result = await authorizeCodeFrost(from, 'sms');
        reply = result
          ? `Code Frost authorized. ${result.overflowSitesOpened} overflow sites are now open.`
          : 'There is no Code Frost waiting for authorization.';
      }
    } else if (od) {
      // SRS FR 5.2: offline overdose alert relayed by SMS from a registered field phone.
      const userId = config.fieldNumbers.get(from);
      const lat = Number(od[1]);
      const lng = Number(od[2]);
      if (!userId) reply = 'This phone is not registered for SMS alerts. Call 9-1-1.';
      else if (!latLng.safeParse({ lat, lng }).success) reply = 'Could not read the location. Call 9-1-1.';
      else {
        const incident = await createIncident(userId, lat, lng, 'sms');
        reply = `Overdose alert sent to ${incident.alerted.length} nearby responder(s). Call 9-1-1 now.`;
      }
    } else {
      reply = 'Cold-Grid: reply AUTHORIZE (on-call only) or OD <lat>,<lng>.';
    }
    res.type('text/xml').send(twimlMessage(reply));
  });

  // ---- Everything below needs a valid token ---------------------------------------------------
  app.use('/api', authenticate);

  app.get('/api/me', (req, res) => {
    res.json(currentUser(req));
  });

  // Module 1: live bed telemetry
  app.get('/api/snapshot', requirePermission('read:capacity'), async (_req, res) => {
    res.json(await computeSnapshot());
  });

  const shelterUpdate = z
    .object({ capacity: z.number().int().min(0).max(2000).optional(), occupied: z.number().int().min(0).max(2000).optional() })
    .refine((v) => v.capacity !== undefined || v.occupied !== undefined, 'Nothing to update');

  app.patch('/api/shelters/:id', requirePermission('write:capacity'), async (req, res) => {
    const user = currentUser(req);
    const id = String(req.params.id);
    if (!canManageShelter(user, id)) throw forbidden('Not your shelter');
    const body = shelterUpdate.parse(req.body);
    const shelter = await col.shelters().findOne({ _id: id });
    if (!shelter) throw notFound('Shelter not found');
    const capacity = body.capacity ?? shelter.capacity;
    const occupied = body.occupied ?? shelter.occupied;
    if (occupied > capacity) throw badRequest('Occupied cannot exceed capacity');
    await col.shelters().updateOne({ _id: id }, { $set: { capacity, occupied, updatedAt: new Date() } });
    res.json({ ok: true });
  });

  // +1 / -1 buttons on the shelter screen. Atomic, so two staff tapping at once cannot overshoot.
  app.post('/api/shelters/:id/occupancy', requirePermission('write:capacity'), async (req, res) => {
    const user = currentUser(req);
    const id = String(req.params.id);
    if (!canManageShelter(user, id)) throw forbidden('Not your shelter');
    const { delta } = z.object({ delta: z.union([z.literal(1), z.literal(-1)]) }).parse(req.body);
    const filter =
      delta === 1 ? { _id: id, $expr: { $lt: ['$occupied', '$capacity'] } } : { _id: id, occupied: { $gt: 0 } };
    const result = await col.shelters().updateOne(filter, { $inc: { occupied: delta }, $set: { updatedAt: new Date() } });
    if (result.matchedCount === 0) throw badRequest(delta === 1 ? 'Shelter is at capacity' : 'Occupancy is already 0');
    res.json({ ok: true });
  });

  app.get('/api/shelters/:id/holds', requirePermission('confirm:hold'), async (req, res) => {
    const user = currentUser(req);
    const id = String(req.params.id);
    if (!canManageShelter(user, id)) throw forbidden('Not your shelter');
    res.json(await holdsForShelter(id));
  });

  // Module 2: intake matching and bed holds
  app.post('/api/match', requirePermission('create:hold'), async (req, res) => {
    res.json(await findMatches(triageSchema.parse(req.body)));
  });

  app.post('/api/holds', requirePermission('create:hold'), async (req, res) => {
    const { shelterId } = z.object({ shelterId: z.string().min(1) }).parse(req.body);
    const hold = await createHold(currentUser(req), shelterId);
    res.status(201).json(serializeHold(hold));
  });

  app.get('/api/holds/mine', requirePermission('create:hold'), async (req, res) => {
    res.json(await holdsByUser(currentUser(req).sub));
  });

  app.delete('/api/holds/:id', requirePermission('create:hold'), async (req, res) => {
    await cancelHold(currentUser(req), String(req.params.id));
    res.status(204).end();
  });

  app.post('/api/holds/:id/confirm', requirePermission('confirm:hold'), async (req, res) => {
    await confirmHold(currentUser(req), String(req.params.id));
    res.json({ ok: true });
  });

  // Module 4: overdose response mesh
  app.post('/api/incidents', requirePermission('create:alert'), async (req, res) => {
    const { lat, lng } = latLng.parse(req.body);
    const incident = await createIncident(currentUser(req).sub, lat, lng, 'app');
    res.status(201).json({
      id: incident._id.toHexString(),
      alertedCount: incident.alerted.length,
      dispatchMs: incident.dispatchMs,
    });
  });

  app.get('/api/incidents/mine', requirePermission('respond:alert'), async (req, res) => {
    res.json(await openAlertsFor(currentUser(req).sub));
  });

  app.get('/api/incidents', requirePermission('read:audit'), async (_req, res) => {
    res.json(await recentIncidents());
  });

  app.get('/api/incidents/:id', async (req, res) => {
    res.json(await getIncidentFor(currentUser(req), String(req.params.id)));
  });

  app.post('/api/incidents/:id/accept', requirePermission('respond:alert'), async (req, res) => {
    res.json(await acceptIncident(currentUser(req), String(req.params.id)));
  });

  app.post('/api/incidents/:id/resolve', requirePermission('respond:alert'), async (req, res) => {
    res.json(await resolveIncident(currentUser(req), String(req.params.id)));
  });

  // Module 3: Code Frost
  app.get('/api/codefrost', requirePermission('read:capacity'), async (_req, res) => {
    res.json(await codeFrostState());
  });

  app.post('/api/codefrost/override', requirePermission('execute:code_frost'), async (req, res) => {
    const body = z
      .union([
        z.object({ tempC: z.number().min(-60).max(50), windKmh: z.number().min(0).max(200) }),
        z.object({ clear: z.literal(true) }),
      ])
      .parse(req.body);
    await setWeatherOverride('clear' in body ? null : body);
    res.json(await evaluateCodeFrost());
  });

  app.post('/api/codefrost/evaluate', requirePermission('execute:code_frost'), async (_req, res) => {
    res.json(await evaluateCodeFrost());
  });

  app.post('/api/codefrost/authorize', requirePermission('execute:code_frost'), async (req, res) => {
    const result = await authorizeCodeFrost(currentUser(req).sub, 'dashboard');
    if (!result) throw new HttpError(409, 'No Code Frost is waiting for authorization');
    res.json(result);
  });

  app.post('/api/codefrost/end', requirePermission('execute:code_frost'), async (req, res) => {
    const result = await endCodeFrost(currentUser(req).sub);
    if (!result) throw new HttpError(409, 'No Code Frost is open');
    res.json(result);
  });

  // History (Tiger Data / TimescaleDB): trends for City Ops
  app.get('/api/history', requirePermission('read:audit'), async (req, res) => {
    const range = z.enum(['24h', '7d']).catch('24h').parse(req.query.range);
    const status = historyStatus();
    if (!status.enabled) {
      res.json({ status, city: null, shelters: null, incidents: null });
      return;
    }
    try {
      const [city, shelters, incidents] = await Promise.all([cityHistory(range), shelterHistory(range), incidentHistory(range)]);
      res.json({ status: historyStatus(), city, shelters, incidents });
    } catch (err) {
      // Fail soft: history problems never break the dashboard.
      res.json({ status: { ...historyStatus(), lastError: (err as Error).message }, city: null, shelters: null, incidents: null });
    }
  });

  // Module 6: audit trail and communications log
  app.get('/api/audit', requirePermission('read:audit'), async (_req, res) => {
    const list = await col.audit().find({}).sort({ at: -1, _id: -1 }).limit(100).toArray();
    res.json(list.map(serializeAudit));
  });

  app.get('/api/audit/:id/verify', requirePermission('read:audit'), async (req, res) => {
    const result = await verifyAudit(String(req.params.id));
    if (!result) throw notFound('Audit event not found');
    res.json(result);
  });

  app.get('/api/outbox', requirePermission('read:audit'), async (_req, res) => {
    res.json(await recentOutbox());
  });

  // Demo controls (SRS FR 3.7). Disable with DEMO_CONTROLS=false.
  if (config.demoControls) {
    app.post('/api/demo/reset', requirePermission('execute:code_frost'), async (_req, res) => {
      await resetDemo();
      res.json({ ok: true });
    });
    app.post('/api/demo/surge', requirePermission('execute:code_frost'), async (_req, res) => {
      await surgeDemo();
      res.json({ ok: true });
    });
    app.post('/api/demo/history', requirePermission('execute:code_frost'), async (req, res) => {
      const { clear } = z.object({ clear: z.boolean().optional() }).parse(req.body ?? {});
      if (!historyStatus().enabled) throw new HttpError(409, 'Tiger Data is not configured (TIGER_DATABASE_URL)');
      if (clear) {
        await clearSimulated();
        res.json({ ok: true, reason: 'Simulated history cleared' });
        return;
      }
      const samples = await backfillSimulated();
      res.json({ ok: true, reason: `Loaded ${samples} simulated samples (7 days)` });
    });
  }

  app.use('/api', (_req, _res, next) => next(notFound('No such endpoint')));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'Invalid request', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[api] unhandled error', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
