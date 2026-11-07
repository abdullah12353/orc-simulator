// #69 World jobs go to the Worker. Its answers become data or a Player-facing line; a closed gutter
// (#70's `503 {"error":"gutter_closed"}`) says the same as the banner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUTTER_CLOSED_LINE, readWorkerAnswer } from '../src/worker-answer.ts';

const answer = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a 2xx answer is the data', async () => {
  assert.deepEqual(await readWorkerAnswer(answer(201, { worldId: 'w-1' }), 'nope'), { data: { worldId: 'w-1' } });
});

test("a 503 gutter_closed is the closed gutter's line", async () => {
  assert.equal(GUTTER_CLOSED_LINE, 'The gutter is closed till the 1st.');
  assert.deepEqual(await readWorkerAnswer(answer(503, { error: 'gutter_closed' }), 'nope'), { error: GUTTER_CLOSED_LINE });
});

test("a refusal's reason becomes its line; an unknown reason is shown as it is", async () => {
  assert.deepEqual(await readWorkerAnswer(answer(403, { error: 'not_a_player' }), 'nope'), {
    error: 'Only Players in this world can do that.',
  });
  assert.deepEqual(await readWorkerAnswer(answer(400, { error: 'name must be 1-60 characters' }), 'nope'), {
    error: 'name must be 1-60 characters',
  });
});

test('a 401 asks to sign in; anything without a reason is the fallback', async () => {
  assert.deepEqual(await readWorkerAnswer(answer(401, { error: 'sign in first' }), 'nope'), { error: 'Sign in first.' });
  assert.deepEqual(await readWorkerAnswer(answer(500, undefined), 'The Herald did not arrive.'), { error: 'The Herald did not arrive.' });
  assert.deepEqual(await readWorkerAnswer(new Response('<html>', { status: 502 }), 'nope'), { error: 'nope' });
});
