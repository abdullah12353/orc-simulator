// #68 The client's live socket: open only while visible, a fresh token on every open, reconnects backing
// off from 1 s to 30 s, `ready` on every (re)open as the cue to refetch, and no more retries once the DO
// closes it as gutter-closed (or not a Player). Fake sockets, timers and visibility.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE, liveConnection, retryDelay, type LiveEnv, type SocketLike } from '../src/live-socket.ts';

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
  }
  // the server's side
  opens() {
    this.onopen?.();
  }
  says(m: unknown) {
    this.onmessage?.({ data: typeof m === 'string' ? m : JSON.stringify(m) });
  }
  drops(code: number, reason = '') {
    this.onclose?.({ code, reason });
  }
}

/** A fake browser: a manual clock with timers, visibility, and the sockets it opened. */
function fakeBrowser(opts: { visible?: boolean } = {}) {
  let now = 0;
  let visible = opts.visible ?? true;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  const sockets: FakeSocket[] = [];
  const visibility = new Set<() => void>();
  let tokens = 0;
  const env: LiveEnv = {
    workerUrl: 'https://worker.test',
    token: async () => `jwt-${++tokens}`,
    openSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    visible: () => visible,
    onVisibilityChange: (cb) => {
      visibility.add(cb);
      return () => visibility.delete(cb);
    },
    setTimeout: (fn, ms) => {
      timers.set(nextId, { at: now + ms, fn });
      return nextId++;
    },
    clearTimeout: (h) => void timers.delete(h as number),
    setInterval: (fn, ms) => {
      timers.set(nextId, { at: now + ms, fn, every: ms });
      return nextId++;
    },
    clearInterval: (h) => void timers.delete(h as number),
    now: () => now,
  };
  const flush = () => new Promise<void>((r) => setImmediate(r));
  return {
    env,
    sockets,
    last: () => sockets.at(-1)!,
    pendingDelays: () => [...timers.values()].filter((t) => !t.every).map((t) => t.at - now),
    /** Moves the clock, firing due timers in order. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, t] = due;
        now = t.at;
        if (t.every) t.at += t.every;
        else timers.delete(id);
        t.fn();
        await flush();
      }
      now = end;
      await flush();
    },
    async setVisible(v: boolean) {
      visible = v;
      for (const cb of visibility) cb();
      await flush();
    },
    flush,
  };
}

function recorder() {
  const events: string[] = [];
  return {
    events,
    handlers: {
      ready: (n: number) => void events.push(`ready ${n}`),
      tick: (n: number) => void events.push(`tick ${n}`),
      dialogue: (n: number) => void events.push(`dialogue ${n}`),
    },
  };
}

test('the backoff runs 1 s, 2 s, 4 s … and stops growing at 30 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map(retryDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test('it opens with a fresh token in the URL, and passes on ready, tick and dialogue', async () => {
  const b = fakeBrowser();
  const r = recorder();
  liveConnection('w-1', b.env, r.handlers);
  await b.flush();
  assert.equal(b.last().url, 'https://worker.test/worlds/w-1/live?token=jwt-1');
  b.last().opens();
  b.last().says({ type: 'ready', tick_seq: 290 });
  b.last().says({ type: 'tick', tick_seq: 291 });
  b.last().says({ type: 'dialogue', fact_no: 88 });
  b.last().says('pong');
  b.last().says('not json');
  assert.deepEqual(r.events, ['ready 290', 'tick 291', 'dialogue 88']);
});

test('a dropped socket reconnects after 1 s, 2 s, 4 s …, each with a new token; ready resets the backoff and refetches', async () => {
  const b = fakeBrowser();
  const r = recorder();
  const c = liveConnection('w-1', b.env, r.handlers);
  await b.flush();

  const delays: number[] = [];
  for (let i = 0; i < 7; i++) {
    b.last().drops(1006);
    assert.equal(c.state(), 'waiting');
    delays.push(b.pendingDelays()[0]!);
    await b.advance(b.pendingDelays()[0]!);
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.equal(b.sockets.length, 8);
  assert.equal(new Set(b.sockets.map((s) => s.url)).size, 8, 'a fresh token every time');

  b.last().opens();
  b.last().says({ type: 'ready', tick_seq: 300 });
  assert.deepEqual(r.events, ['ready 300'], 'the reconnect ends in ready: the screens refetch');
  b.last().drops(1011, 'catch-up failed');
  assert.deepEqual(b.pendingDelays(), [1000], 'after a full open the backoff starts again at 1 s');
});

test('hiding the app closes the socket and cancels any retry; showing it reopens at once', async () => {
  const b = fakeBrowser();
  const r = recorder();
  const c = liveConnection('w-1', b.env, r.handlers);
  await b.flush();
  b.last().opens();
  b.last().says({ type: 'ready', tick_seq: 290 });

  await b.setVisible(false);
  assert.deepEqual(b.last().closedWith, { code: 1000, reason: 'hidden' });
  assert.equal(c.state(), 'hidden');
  await b.advance(10 * 60_000);
  assert.equal(b.sockets.length, 1, 'nothing reopens while hidden');

  await b.setVisible(true);
  assert.equal(b.sockets.length, 2);
  b.last().opens();
  b.last().says({ type: 'ready', tick_seq: 299 });
  assert.deepEqual(r.events, ['ready 290', 'ready 299']);

  // Hidden while waiting to retry: the retry is cancelled too.
  b.last().drops(1006);
  await b.setVisible(false);
  await b.advance(60_000);
  assert.equal(b.sockets.length, 2);
});

test('it never opens while the app starts hidden', async () => {
  const b = fakeBrowser({ visible: false });
  const c = liveConnection('w-1', b.env, recorder().handlers);
  await b.flush();
  assert.equal(b.sockets.length, 0);
  assert.equal(c.state(), 'hidden');
  await b.setVisible(true);
  assert.equal(b.sockets.length, 1);
});

test('the gutter-closed code (4013) stops the retrying; so does not-a-Player (4003)', async () => {
  for (const code of [LIVE.gutterClosedCode, LIVE.notAPlayerCode]) {
    const b = fakeBrowser();
    const c = liveConnection('w-1', b.env, recorder().handlers);
    await b.flush();
    b.last().drops(code, 'gutter closed');
    assert.equal(c.state(), 'stopped');
    assert.equal(c.stoppedBy(), code);
    await b.advance(60 * 60_000);
    assert.equal(b.sockets.length, 1, 'no retry');

    // Coming back to the app tries once more (the gutter reopens on the 1st).
    await b.setVisible(false);
    await b.setVisible(true);
    assert.equal(b.sockets.length, 2);
  }
  assert.equal(LIVE.gutterClosedCode, 4013);
});

test('it pings every 30 s, and a socket silent for two pings is dropped and reopened', async () => {
  const b = fakeBrowser();
  liveConnection('w-1', b.env, recorder().handlers);
  await b.flush();
  const first = b.last();
  first.opens();
  await b.advance(30_000);
  assert.deepEqual(first.sent, ['ping']);
  first.says('pong');
  await b.advance(60_000);
  assert.deepEqual(first.sent, ['ping', 'ping', 'ping']);
  assert.equal(first.closedWith, null, 'still within 75 s of the last pong');
  await b.advance(30_000);
  assert.deepEqual(first.closedWith, { code: 1000, reason: 'silent' });
  await b.advance(1_000);
  assert.equal(b.sockets.length, 2, 'reopened after the backoff');
});

test('closing it closes the socket and stops everything', async () => {
  const b = fakeBrowser();
  const c = liveConnection('w-1', b.env, recorder().handlers);
  await b.flush();
  b.last().opens();
  c.close();
  assert.deepEqual(b.last().closedWith, { code: 1000, reason: 'done' });
  await b.setVisible(false);
  await b.setVisible(true);
  await b.advance(60 * 60_000);
  assert.equal(b.sockets.length, 1);
  assert.equal(c.state(), 'closed');
});
