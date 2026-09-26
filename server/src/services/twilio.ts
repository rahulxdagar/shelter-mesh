import { ObjectId } from 'mongodb';
import twilio from 'twilio';
import { config } from '../config.ts';
import { col } from '../db.ts';
import { rt } from '../realtime.ts';
import type { OutboxDoc } from '../types.ts';

const client = config.twilio ? twilio(config.twilio.accountSid, config.twilio.authToken) : null;
const fromNumber = config.twilio?.fromNumber ?? '+15550000000';

export function smsNumber(): string {
  return fromNumber;
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

export function twimlMessage(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(text)}</Message></Response>`;
}

export function serializeOutbox(o: OutboxDoc) {
  return { ...o, id: o._id.toHexString(), _id: undefined, at: o.at.toISOString() };
}

async function log(entry: Omit<OutboxDoc, '_id' | 'at'>) {
  const doc: OutboxDoc = { _id: new ObjectId(), at: new Date(), ...entry };
  await col.outbox().insertOne(doc);
  rt.toPermission('read:audit', 'outbox', serializeOutbox(doc));
  return doc;
}

// When Twilio is not configured, messages are recorded as "simulated" and shown in the ops outbox.
export async function sendSms(to: string, body: string) {
  if (!client) return log({ channel: 'sms', direction: 'out', to, from: fromNumber, body, status: 'simulated' });
  try {
    await client.messages.create({ to, from: fromNumber, body });
    return log({ channel: 'sms', direction: 'out', to, from: fromNumber, body, status: 'sent' });
  } catch (err) {
    return log({ channel: 'sms', direction: 'out', to, from: fromNumber, body, status: 'failed', error: (err as Error).message });
  }
}

export async function voiceCall(to: string, message: string) {
  const say = `<Say voice="Polly.Joanna">${xmlEscape(message)}</Say>`;
  const twiml = `<Response>${say}<Pause length="1"/>${say}</Response>`;
  if (!client) return log({ channel: 'voice', direction: 'out', to, from: fromNumber, body: message, status: 'simulated' });
  try {
    await client.calls.create({ to, from: fromNumber, twiml });
    return log({ channel: 'voice', direction: 'out', to, from: fromNumber, body: message, status: 'sent' });
  } catch (err) {
    return log({ channel: 'voice', direction: 'out', to, from: fromNumber, body: message, status: 'failed', error: (err as Error).message });
  }
}

export async function logInbound(from: string, body: string) {
  return log({ channel: 'sms', direction: 'in', to: fromNumber, from, body, status: 'received' });
}

// SRS NFR 1.4: with Twilio configured, every webhook must carry a valid X-Twilio-Signature.
// Without Twilio (dev), the dashboard's "simulate reply" posts unsigned requests.
export function isValidWebhook(signature: string | undefined, url: string, params: Record<string, string>): boolean {
  if (!config.twilio) return !config.isProduction;
  if (!signature) return false;
  return twilio.validateRequest(config.twilio.authToken, signature, url, params);
}

export async function recentOutbox() {
  const list = await col.outbox().find({}).sort({ at: -1 }).limit(50).toArray();
  return list.map(serializeOutbox);
}
