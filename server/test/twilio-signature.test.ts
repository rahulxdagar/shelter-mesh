// Runs with Twilio "configured" (fake credentials) to check webhook signature enforcement.
// Only messages that produce no outbound Twilio calls are sent, so nothing hits the network.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.TWILIO_ACCOUNT_SID = 'AC00000000000000000000000000000000';
process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
process.env.TWILIO_FROM_NUMBER = '+15550001111';
process.env.PUBLIC_API_URL = 'https://api.example.test';

const { default: supertest } = await import('supertest');
const { default: twilio } = await import('twilio');
const { createApp } = await import('../src/app.ts');
const { connectDb, closeDb } = await import('../src/db.ts');

let request: ReturnType<typeof supertest>;
before(async () => {
  await connectDb(null, 'coldgrid-test');
  request = supertest(createApp());
});
after(closeDb);

const params = { From: '+15551234567', Body: 'HELLO' };
const url = 'https://api.example.test/api/twilio/sms';

describe('Twilio webhook signature', () => {
  it('rejects a missing signature', async () => {
    const res = await request.post('/api/twilio/sms').type('form').send(params);
    assert.equal(res.status, 403);
  });

  it('rejects a wrong signature', async () => {
    const res = await request.post('/api/twilio/sms').type('form').set('X-Twilio-Signature', 'bad').send(params);
    assert.equal(res.status, 403);
  });

  it('accepts a valid signature', async () => {
    const sig = twilio.getExpectedTwilioSignature('test-auth-token', url, params);
    const res = await request.post('/api/twilio/sms').type('form').set('X-Twilio-Signature', sig).send(params);
    assert.equal(res.status, 200);
    assert.match(res.text, /<Response><Message>Cold-Grid: reply AUTHORIZE/);
  });
});
