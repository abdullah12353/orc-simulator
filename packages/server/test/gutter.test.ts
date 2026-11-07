// #70: the usage guard picks normal, slow or closed from Neon's compute this period, and lifts when the
// period ends. No database: the Neon API is a fake `fetch`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUTTER, gutterState, nextMonthStart, readNeonUsage } from '@orc/server';

const NOW = new Date('2026-11-20T12:00:00Z');
const PERIOD_END = '2026-12-01T00:00:00.000Z';
const reading = (cuHours: number, periodEnd = PERIOD_END) => ({ cuHours, periodEnd });

test('the guard picks normal, slow or closed from the CU-hours used this period', () => {
  assert.equal(gutterState(reading(0), NOW), 'normal');
  assert.equal(gutterState(reading(79.99), NOW), 'normal');
  assert.equal(gutterState(reading(GUTTER.slowCuHours), NOW), 'slow', 'slow at 80');
  assert.equal(gutterState(reading(85), NOW), 'slow');
  assert.equal(gutterState(reading(94.99), NOW), 'slow');
  assert.equal(gutterState(reading(GUTTER.closedCuHours), NOW), 'closed', 'closed at 95');
  assert.equal(gutterState(reading(96), NOW), 'closed');
  assert.equal(gutterState(reading(130), NOW), 'closed', 'past the cap is still closed');
});

test('no reading yet, or a reading that makes no sense, leaves the gutter open', () => {
  assert.equal(gutterState(null, NOW), 'normal');
  assert.equal(gutterState(undefined, NOW), 'normal');
  assert.equal(gutterState(reading(96, 'not a date'), NOW), 'normal');
});

test('slow and closed lift by themselves when the month rolls over, before the next reading', () => {
  const lastOfMonth = new Date('2026-11-30T23:59:59.999Z');
  const theFirst = new Date(PERIOD_END);
  assert.equal(gutterState(reading(96), lastOfMonth), 'closed');
  assert.equal(gutterState(reading(96), theFirst), 'normal', 'closed till the 1st, open on it');
  assert.equal(gutterState(reading(85), theFirst), 'normal');
  assert.equal(gutterState(reading(96), new Date('2027-01-15T00:00:00Z')), 'normal', 'a reading months old counts for nothing');
  // The next period's first (lagging) reading starts the count again.
  assert.equal(gutterState(reading(1.2, '2027-01-01T00:00:00Z'), theFirst), 'normal');
});

test('the period ends on the 1st of next month, 00:00 UTC, across a year end', () => {
  assert.equal(nextMonthStart(NOW), PERIOD_END);
  assert.equal(nextMonthStart(new Date('2026-12-31T23:59:59Z')), '2027-01-01T00:00:00.000Z');
  assert.equal(nextMonthStart(new Date('2027-01-01T00:00:00Z')), '2027-02-01T00:00:00.000Z');
});

/** Neon's project API answering `status` with `body`, recording what was asked. */
function neon(status: number, body: unknown) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

test("the reading is the project's compute_time_seconds / 3600, with the period's end", async () => {
  const api = neon(200, {
    project: {
      id: 'orc-test',
      compute_time_seconds: 306_000, // 85 CU-h
      active_time_seconds: 1_224_000,
      consumption_period_start: '2026-11-01T00:00:00Z',
      consumption_period_end: '2026-12-01T00:00:00Z',
    },
  });
  const r = await readNeonUsage({ fetch: api.fetch, projectId: 'orc-test', apiKey: 'k', now: NOW });
  assert.deepEqual(r, { cuHours: 85, periodEnd: PERIOD_END, readAt: NOW.toISOString() });
  assert.deepEqual(api.calls, [{ url: 'https://console.neon.tech/api/v2/projects/orc-test', auth: 'Bearer k' }]);
  assert.equal(gutterState(r, NOW), 'slow');
});

test('without a period end the reading counts till the 1st', async () => {
  const api = neon(200, { project: { compute_time_seconds: 3600 } });
  const r = await readNeonUsage({ fetch: api.fetch, projectId: 'p', apiKey: 'k', now: NOW });
  assert.equal(r.cuHours, 1);
  assert.equal(r.periodEnd, PERIOD_END);
});

test('an error or a malformed answer throws, so it never passes for a figure', async () => {
  const read = (status: number, body: unknown) => readNeonUsage({ fetch: neon(status, body).fetch, projectId: 'p', apiKey: 'k', now: NOW });
  await assert.rejects(read(401, { message: 'unauthorized' }), /401/);
  await assert.rejects(read(500, {}), /500/);
  await assert.rejects(read(200, {}), /compute_time_seconds/);
  await assert.rejects(read(200, { project: { compute_time_seconds: '12' } }), /compute_time_seconds/);
  await assert.rejects(read(200, { project: { compute_time_seconds: -1 } }), /compute_time_seconds/);
});
