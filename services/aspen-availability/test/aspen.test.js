import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanZip, cleanProduct, shapeResponse, createClient, AspenError } from '../src/aspen.js';

test('cleanZip only takes 5 digits', () => {
  assert.equal(cleanZip(' 17601 '), '17601');
  assert.equal(cleanZip('1760'), null);
  assert.equal(cleanZip('abcde'), null);
  assert.equal(cleanZip(undefined), null);
});

test('cleanProduct normalizes case/order and rejects unknowns', () => {
  assert.equal(cleanProduct(''), '');
  assert.equal(cleanProduct(null), '');
  assert.equal(cleanProduct('windows'), 'Windows');
  assert.equal(cleanProduct('windows, Doors,windows'), 'Doors,Windows');
  assert.equal(cleanProduct('Pools'), null);
});

test('shapeResponse keeps just the start times', () => {
  const out = shapeResponse({
    zip: '17601',
    serviced: true,
    slots: [{ date: '2026-10-24', time: '9:00 AM', start: '2026-10-24T09:00:00-04:00' }],
    window: { from: '2026-10-24', through: '2026-11-01' },
    partial: false,
    engineVersion: 'p1.0.0',
  });
  assert.deepEqual(out, {
    zip: '17601',
    serviced: true,
    slots: ['2026-10-24T09:00:00-04:00'],
    window: { from: '2026-10-24', through: '2026-11-01' },
    partial: false,
    reason: null,
  });
});

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), key: init.headers['x-api-key'] });
    const r = responses.shift();
    return new Response(JSON.stringify(r.body || {}), { status: r.status || 200, headers: r.headers || {} });
  };
  fn.calls = calls;
  return fn;
}

test('lookup sends the key, caches hits, and skips caching failures', async () => {
  let t = 0;
  const fetchImpl = fakeFetch([
    { status: 503, body: { error: 'down' } },
    { body: { zip: '17601', serviced: true, slots: [] } },
  ]);
  const lookup = createClient({ apiKey: 'k', fetchImpl, now: () => t });

  await assert.rejects(lookup('17601', 'Windows'), (e) => e instanceof AspenError && e.status === 503);
  await lookup('17601', 'Windows');
  await lookup('17601', 'Windows'); // cached
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[0].key, 'k');
  assert.match(fetchImpl.calls[0].url, /zip=17601&product=Windows/);
});

test('lookup surfaces 429 with Retry-After', async () => {
  const fetchImpl = fakeFetch([{ status: 429, body: {}, headers: { 'retry-after': '42' } }]);
  const lookup = createClient({ apiKey: 'k', fetchImpl });
  await assert.rejects(lookup('17601', ''), (e) => e.status === 429 && e.retryAfter === 42);
});
