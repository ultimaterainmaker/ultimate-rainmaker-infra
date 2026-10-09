// Runs the GHL snippet the way GHL does (code wrapped in an async fn with inputData).
// node --test ghl/zip-gate-workflow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('./zip-gate-workflow.js', import.meta.url), 'utf8');
const run = (inputData) => new Function('inputData', `return (async () => { let output; ${code} })();`)(inputData);

test('Jackie (Annville 17003) is in Lebanon county', async () => {
  const r = await run({ address: '408 West Queen St Annville 17003' });
  assert.deepEqual(r, { zip: '17003', county: 'PA Lebanon', inServiceArea: 'true', reason: 'ok' });
});

test('out of area', async () => {
  const r = await run({ address: '1 Main St Pittsburgh PA 15201' });
  assert.equal(r.inServiceArea, 'false');
  assert.equal(r.reason, 'out_of_area');
});

test('5-digit house number does not fool it', async () => {
  const r = await run({ address: '17003 Long Rd, Pittsburgh, PA 15201-1234' });
  assert.equal(r.zip, '15201');
  assert.equal(r.inServiceArea, 'false');
});

test('no zip in address', async () => {
  const r = await run({ address: '408 West Queen St Annville' });
  assert.equal(r.reason, 'no_zip');
  assert.equal(r.inServiceArea, 'false');
});

test('dedicated zip field wins', async () => {
  const r = await run({ zip: '21701', address: 'whatever 15201' });
  assert.equal(r.county, 'MD Frederick');
});

test('empty inputs do not crash', async () => {
  assert.equal((await run({})).reason, 'no_zip');
});
