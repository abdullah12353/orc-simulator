// Burns a calibrated amount of CPU (~20k LCG steps per ms, calibrated on V8 locally).
// Wall clocks are frozen during compute in Workers, so the truth comes from tail/logs cpuTime.
import { DurableObject } from "cloudflare:workers";

const PER_MS = 20000;
function burn(ms) {
  let x = 1;
  const n = ms * PER_MS;
  for (let i = 0; i < n; i++) x = (x * 1103515245 + 12345) % 2147483648;
  return x;
}

export class Burner extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "create table if not exists runs (id integer primary key, kind text, ms int, attempt int, retry int, ok int, at text)"
    );
  }
  async fetch(req) {
    const u = new URL(req.url);
    const ms = Number(u.searchParams.get("ms") || 0);
    if (u.pathname === "/do/burn") {
      const x = burn(ms);
      this.ctx.storage.sql.exec("insert into runs (kind, ms, attempt, retry, ok, at) values ('http', ?, 1, 0, 1, ?)", ms, new Date().toISOString());
      return Response.json({ where: "do", ms, x });
    }
    if (u.pathname === "/do/alarm") {
      await this.ctx.storage.put("alarmMs", ms);
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      return Response.json({ scheduled: ms });
    }
    if (u.pathname === "/do/runs") {
      return Response.json(this.ctx.storage.sql.exec("select * from runs order by id").toArray());
    }
    return new Response("not found", { status: 404 });
  }
  async alarm(info) {
    const ms = (await this.ctx.storage.get("alarmMs")) ?? 0;
    // Record the attempt before burning, so a CPU-killed alarm still leaves a trace.
    this.ctx.storage.sql.exec("insert into runs (kind, ms, attempt, retry, ok, at) values ('alarm', ?, ?, ?, 0, ?)",
      ms, info?.retryCount ?? 0, info?.isRetry ? 1 : 0, new Date().toISOString());
    const id = this.ctx.storage.sql.exec("select max(id) as id from runs").one().id;
    burn(ms);
    this.ctx.storage.sql.exec("update runs set ok = 1 where id = ?", id);
  }
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const ms = Number(u.searchParams.get("ms") || 0);
    if (u.pathname === "/worker/burn") return Response.json({ where: "worker", ms, x: burn(ms) });
    if (u.pathname.startsWith("/do/")) {
      const name = u.searchParams.get("name") || "probe";
      return env.BURNER.get(env.BURNER.idFromName(name)).fetch(req);
    }
    return new Response("orc-do-cpu-probe", { status: 200 });
  },
};
