// Throwaway probe for #65 (items 1 and 2). Never merges. Delete the Worker after (`wrangler delete`).
//
// Item 1: postgres.js inside a SQLite-backed Durable Object, straight to Neon's pooler over TCP
//         (cloudflare:sockets, via postgres.js's `workerd` build), a transaction with FOR UPDATE NOWAIT,
//         a second connection proving NOWAIT fails fast (55P03), then sql.end().
// Item 2: one hibernating WebSocket (acceptWebSocket + auto-response pings), an alarm every minute
//         doing a small Postgres transaction and closing the connection, then fanning a hint out after commit.
import { DurableObject } from "cloudflare:workers";
import postgres from "postgres";

const db = (env, extra = {}) =>
  postgres(env.DB_URL, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5, ...extra });

async function setup(env) {
  const sql = db(env);
  try {
    await sql`create table if not exists probe65_lock (id int primary key, n int not null default 0, at timestamptz)`;
    await sql`insert into probe65_lock (id) values (1) on conflict (id) do nothing`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// One small transaction, the shape of a tick's "claim the world" step. Returns timings in ms.
async function smallTx(env) {
  const t0 = Date.now();
  const sql = db(env);
  let n, tConnected, tCommitted;
  try {
    await sql.begin(async (tx) => {
      tConnected = Date.now();
      const [row] = await tx`select n from probe65_lock where id = 1 for update nowait`;
      [{ n }] = await tx`update probe65_lock set n = ${row.n + 1}, at = now() where id = 1 returning n`;
    });
    tCommitted = Date.now();
  } finally {
    await sql.end({ timeout: 5 });
  }
  return { n, toBeginMs: tConnected - t0, txMs: tCommitted - tConnected, totalMs: Date.now() - t0 };
}

export class Probe extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(`create table if not exists log (id integer primary key, at text, kind text, data text)`);
    // Every constructor run is a fresh wake from hibernation/eviction.
    this.log("wake", {});
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  log(kind, data) {
    this.ctx.storage.sql.exec("insert into log (at, kind, data) values (?, ?, ?)", new Date().toISOString(), kind, JSON.stringify(data));
  }

  async fetch(req) {
    const u = new URL(req.url);

    if (u.pathname === "/do/tx") {
      // Item 1, the full check.
      const out = {};
      const t0 = Date.now();
      await setup(this.env);
      out.setupMs = Date.now() - t0;
      out.first = await smallTx(this.env);

      // NOWAIT contention: A holds the row lock, B asks for it with NOWAIT and must fail at once.
      const a = db(this.env);
      const b = db(this.env);
      try {
        await a.begin(async (txA) => {
          await txA`select n from probe65_lock where id = 1 for update`;
          const tB = Date.now();
          try {
            await b.begin(async (txB) => txB`select n from probe65_lock where id = 1 for update nowait`);
            out.nowait = { failed: false, ms: Date.now() - tB };
          } catch (e) {
            out.nowait = { failed: true, code: e.code, message: e.message, ms: Date.now() - tB };
          }
          const [{ pid }] = await txA`select pg_backend_pid() as pid`;
          const [{ v }] = await txA`select version() as v`;
          out.server = { pid, version: v.split(",")[0] };
        });
        out.aCommitted = true;
      } finally {
        await Promise.all([a.end({ timeout: 5 }), b.end({ timeout: 5 })]);
      }
      out.second = await smallTx(this.env);
      out.totalMs = Date.now() - t0;
      this.log("tx", out);
      return Response.json(out);
    }

    if (u.pathname === "/do/ws") {
      if (req.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      this.log("ws-open", { sockets: this.ctx.getWebSockets().length });
      const limit = Number(u.searchParams.get("alarms") || 60);
      if (limit > 0 && (await this.ctx.storage.getAlarm()) == null) {
        await this.ctx.storage.put({ alarmsLeft: limit, alarmNo: 0 });
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
        this.log("alarm-armed", { limit });
      }
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (u.pathname === "/do/log") {
      const since = Number(u.searchParams.get("since") || 0);
      return Response.json(this.ctx.storage.sql.exec("select * from log where id > ? order by id", since).toArray()
        .map((r) => ({ ...r, data: JSON.parse(r.data) })));
    }

    if (u.pathname === "/do/stop") {
      await this.ctx.storage.deleteAlarm();
      for (const ws of this.ctx.getWebSockets()) ws.close(1000, "probe over");
      this.log("stopped", {});
      return Response.json({ stopped: true });
    }

    return new Response("not found", { status: 404 });
  }

  async alarm(info) {
    const left = (await this.ctx.storage.get("alarmsLeft")) ?? 0;
    const no = ((await this.ctx.storage.get("alarmNo")) ?? 0) + 1;
    // Re-arm first, so a failed transaction doesn't end the loop.
    if (left > 1) await this.ctx.storage.setAlarm(Date.now() + 60_000);
    await this.ctx.storage.put({ alarmsLeft: left - 1, alarmNo: no });
    let res;
    try {
      res = { ok: true, ...(await smallTx(this.env)) };
    } catch (e) {
      res = { ok: false, code: e.code, message: String(e.message ?? e) };
    }
    // After commit, fan the hint out (outgoing messages are free).
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) ws.send(JSON.stringify({ type: "tick", no, n: res.n ?? null }));
    this.log("alarm", { no, retry: info?.retryCount ?? 0, sockets: sockets.length, ...res });
  }

  async webSocketMessage(ws, msg) {
    // Should never run for "ping": the auto-response answers it without waking us.
    this.log("ws-message", { msg: String(msg).slice(0, 50) });
  }

  async webSocketClose(ws, code, reason) {
    this.log("ws-close", { code, reason });
  }
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname.startsWith("/do/")) {
      const name = u.searchParams.get("name") || "probe";
      return env.PROBE.get(env.PROBE.idFromName(name)).fetch(req);
    }
    return new Response("orc-probe-do (#65)", { status: 200 });
  },
};
