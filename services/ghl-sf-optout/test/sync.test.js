import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBool, phoneVariants, parseGhlPayload, buildContactUpdate } from '../src/payload.js';
import { syncOptOut } from '../src/sync.js';
import { parseAuthUrl } from '../src/salesforce.js';

test('parses sfdx auth urls', () => {
  assert.deepEqual(parseAuthUrl('force://PlatformCLI::5Aep861abc.def==@acme.my.salesforce.com'), {
    clientId: 'PlatformCLI',
    clientSecret: '',
    refreshToken: '5Aep861abc.def==',
    instanceUrl: 'https://acme.my.salesforce.com',
  });
  assert.equal(parseAuthUrl('force://id:sec:tok@https://acme.my.salesforce.com/').instanceUrl, 'https://acme.my.salesforce.com');
  assert.throws(() => parseAuthUrl('https://nope'));
});

const payload = (overrides = {}) => ({
  contact_id: 'ghl123',
  email: 'Jane@Example.com',
  phone: '+16085551234',
  first_name: 'Jane',
  last_name: 'Doe',
  full_name: 'Jane Doe',
  customData: { call: 'true', sms: 'false', emails: 'false' },
  ...overrides,
});

function fakeClient({ byEmail = [], byPhone = [], failOn = [] } = {}) {
  const calls = { email: [], phone: [], updates: [] };
  return {
    calls,
    async findContactIdsByEmail(e) { calls.email.push(e); return byEmail; },
    async findContactIdsByPhone(v, d) { calls.phone.push(d); return byPhone; },
    async updateContact(id, f) {
      if (failOn.includes(id)) throw new Error('boom');
      calls.updates.push([id, f]);
    },
  };
}

test('toBool handles GHL-ish values', () => {
  assert.equal(toBool('true'), true);
  assert.equal(toBool(' FALSE '), false);
  assert.equal(toBool('Yes'), true);
  assert.equal(toBool(false), false);
  assert.equal(toBool(''), null);
  assert.equal(toBool(undefined), null);
  assert.equal(toBool('{{contact.whatever}}'), null);
});

test('phone variants include the common SF formats', () => {
  const v = phoneVariants('+16085551234');
  assert.ok(v.includes('(608) 555-1234'));
  assert.ok(v.includes('6085551234'));
  assert.ok(v.includes('+16085551234'));
  assert.deepEqual(phoneVariants('555'), []);
});

test('parse maps emails -> HasOptedOutOfEmail and call -> DoNotCall', () => {
  const fields = buildContactUpdate(parseGhlPayload(payload()));
  assert.deepEqual(fields, { HasOptedOutOfEmail: false, DoNotCall: true });
});

test('missing flag is left alone, not overwritten', () => {
  const fields = buildContactUpdate(parseGhlPayload(payload({ customData: { call: 'true' } })));
  assert.deepEqual(fields, { DoNotCall: true });
});

test('matches by email first and skips phone', async () => {
  const c = fakeClient({ byEmail: ['003A'], byPhone: ['003B'] });
  const r = await syncOptOut(payload(), c);
  assert.equal(r.matchedBy, 'email');
  assert.deepEqual(r.updated, ['003A']);
  assert.deepEqual(c.calls.email, ['jane@example.com']);
  assert.equal(c.calls.phone.length, 0);
});

test('falls back to phone when email misses or is blank', async () => {
  const c = fakeClient({ byEmail: [], byPhone: ['003B', '003C'] });
  const r = await syncOptOut(payload({ email: '' }), c);
  assert.equal(r.matchedBy, 'phone');
  assert.deepEqual(r.updated, ['003B', '003C']);
  assert.equal(c.calls.email.length, 0);
  assert.deepEqual(c.calls.phone, ['6085551234']);
});

test('no match is a clean no-op', async () => {
  const r = await syncOptOut(payload(), fakeClient());
  assert.equal(r.matchedBy, null);
  assert.deepEqual(r.updated, []);
});

test('update failures are reported per record', async () => {
  const r = await syncOptOut(payload(), fakeClient({ byEmail: ['003A', '003B'], failOn: ['003B'] }));
  assert.deepEqual(r.updated, ['003A']);
  assert.equal(r.failed[0].id, '003B');
});

test('nothing to update -> skipped without hitting Salesforce', async () => {
  const c = fakeClient({ byEmail: ['003A'] });
  const r = await syncOptOut(payload({ customData: {} }), c);
  assert.ok(r.skipped);
  assert.equal(c.calls.email.length, 0);
});
