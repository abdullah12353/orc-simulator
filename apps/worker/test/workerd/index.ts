// Just enough of workerd to drive the World DO under node --test, with real Postgres behind it: the
// `cloudflare:workers` base class (hooks.mjs), WebSocketPair and the auto-response pair, a Response
// that can be a 101, and a DurableObjectState over memory (storage, alarm, hibernatable sockets).
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);

/** One end of a WebSocketPair: records what's sent and how it was closed. */
export class FakeSocket {
  sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  /** Accepted with `ws.accept()`: an ordinary socket, not a hibernating one. */
  accepted = false;
  private attachment: unknown = null;

  accept(): void {
    this.accepted = true;
  }
  send(message: string): void {
    if (this.closed) throw new Error('the socket is closed');
    this.sent.push(message);
  }
  close(code: number, reason: string): void {
    if (this.closed) throw new Error('the socket is closed');
    this.closed = { code, reason };
  }
  serializeAttachment(value: unknown): void {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment(): unknown {
    return this.attachment;
  }
  /** The messages sent, parsed. */
  messages(): unknown[] {
    return this.sent.map((m) => JSON.parse(m) as unknown);
  }
}

/** The last pair made: [client, server]. */
export let lastPair: [FakeSocket, FakeSocket] | null = null;

Object.assign(globalThis, {
  WebSocketPair: class {
    0: FakeSocket;
    1: FakeSocket;
    constructor() {
      this[0] = new FakeSocket();
      this[1] = new FakeSocket();
      lastPair = [this[0], this[1]];
    }
  },
  WebSocketRequestResponsePair: class {
    request: string;
    response: string;
    constructor(request: string, response: string) {
      this.request = request;
      this.response = response;
    }
  },
});

// Node's Response refuses a 101; workerd's carries the client end of the socket.
const NodeResponse = globalThis.Response;
globalThis.Response = class extends NodeResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
    super(body, init?.status === 101 ? { ...init, status: 200 } : init);
    if (init?.status === 101) Object.defineProperties(this, { status: { value: 101 }, ok: { value: false } });
    Object.defineProperty(this, 'webSocket', { value: init?.webSocket ?? null });
  }
} as typeof Response;

/** A Durable Object's state over memory: storage with its alarm, and the hibernatable sockets. */
export function fakeState() {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;
  const sockets: FakeSocket[] = [];
  const waiting: Promise<unknown>[] = [];
  const storage = {
    async get(key: string | string[]) {
      if (Array.isArray(key)) return new Map(key.filter((k) => data.has(k)).map((k) => [k, data.get(k)]));
      return data.get(key);
    },
    async put(key: string | Record<string, unknown>, value?: unknown) {
      if (typeof key === 'string') data.set(key, value);
      else for (const [k, v] of Object.entries(key)) data.set(k, v);
    },
    async delete(key: string | string[]) {
      for (const k of Array.isArray(key) ? key : [key]) data.delete(k);
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(at: number | Date) {
      alarm = typeof at === 'number' ? at : at.getTime();
    },
    async deleteAlarm() {
      alarm = null;
    },
  };
  return {
    storage,
    data,
    sockets,
    alarm: () => alarm,
    clearAlarm: () => void (alarm = null),
    autoResponse: null as { request: string; response: string } | null,
    acceptWebSocket(ws: FakeSocket) {
      sockets.push(ws);
    },
    /** The hibernatable sockets still open. */
    getWebSockets() {
      return sockets.filter((s) => !s.closed);
    },
    setWebSocketAutoResponse(pair: { request: string; response: string }) {
      this.autoResponse = pair;
    },
    waitUntil(p: Promise<unknown>) {
      waiting.push(p);
    },
    /** Waits for everything handed to waitUntil so far. */
    async settled() {
      await Promise.all(waiting.splice(0));
    },
  };
}
export type FakeState = ReturnType<typeof fakeState>;
