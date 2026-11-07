// #69 Connect, then read (#53 item 2): a world's screens wait for the live socket's `ready`, show anyway
// after 4 s marked possibly stale, and don't wait at all once the DO has refused the socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READY_WAIT_MS, worldGate, type GateTimers, type GateView } from '../src/world-gate.ts';

function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: GateTimers = {
    setTimeout: (fn, ms) => {
      pending.set(next, { at: now + ms, fn });
      return next++;
    },
    clearTimeout: (h) => void pending.delete(h as number),
  };
  return {
    timers,
    pending: () => pending.size,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
  };
}

function gate(already?: { ready: boolean; stopped: boolean }) {
  const t = fakeTimers();
  const views: GateView[] = [];
  const g = worldGate(t.timers, (v) => views.push(v), already);
  return { t, g, views };
}

test('the screens wait for ready, and show as soon as it comes', () => {
  const { t, g, views } = gate();
  assert.equal(g.view(), 'waiting');
  t.advance(3_999);
  assert.equal(g.view(), 'waiting');
  g.ready();
  assert.equal(g.view(), 'ready');
  assert.deepEqual(views, ['ready']);
  assert.equal(t.pending(), 0, 'the 4 s timer is gone');
  t.advance(10_000);
  assert.deepEqual(views, ['ready']);
});

test('no ready within 4 s: the screens show anyway, marked possibly stale; a late ready clears the mark', () => {
  const { t, g, views } = gate();
  assert.equal(READY_WAIT_MS, 4_000);
  t.advance(4_000);
  assert.equal(g.view(), 'stale');
  g.ready();
  assert.equal(g.view(), 'ready');
  assert.deepEqual(views, ['stale', 'ready']);
});

test('a refused socket (gutter closed, not a Player) shows the screens at once, marked stale', () => {
  const { t, g, views } = gate();
  t.advance(500);
  g.stopped();
  assert.equal(g.view(), 'stale');
  assert.equal(t.pending(), 0);
  assert.deepEqual(views, ['stale']);
});

test('a stop after ready changes nothing', () => {
  const { g, views } = gate();
  g.ready();
  g.stopped();
  assert.equal(g.view(), 'ready');
  assert.deepEqual(views, ['ready']);
});

test("a world whose shared socket was already ready (or already refused) doesn't wait again", () => {
  const ready = gate({ ready: true, stopped: false });
  assert.equal(ready.g.view(), 'ready');
  assert.equal(ready.t.pending(), 0);
  const refused = gate({ ready: false, stopped: true });
  assert.equal(refused.g.view(), 'stale');
  assert.equal(refused.t.pending(), 0);
});

test('closing the screen cancels the wait', () => {
  const { t, g, views } = gate();
  g.dispose();
  t.advance(10_000);
  assert.deepEqual(views, []);
});
