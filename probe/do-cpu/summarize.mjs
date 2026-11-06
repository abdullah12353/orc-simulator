// Parse wrangler tail --format json (pretty-printed objects back to back) into a table.
import fs from "node:fs";
const t = fs.readFileSync("tail.jsonl", "utf8"); const objs = []; let d = 0, s = 0, q = false, e = false;
for (let i = 0; i < t.length; i++) { const c = t[i];
  if (q) { if (e) e = false; else if (c == "\\") e = true; else if (c == "\"") q = false; continue; }
  if (c == "\"") q = true; else if (c == "{") { if (d++ == 0) s = i; } else if (c == "}") { if (--d == 0) objs.push(JSON.parse(t.slice(s, i + 1))); } }
for (const o of objs) {
  const r = o.event?.request; if (r && !r.url.includes("/do/alarm") && !r.url.includes("/do/runs") && o.cpuTime < 5 && o.outcome == "ok") continue;
  const what = r ? new URL(r.url).pathname + new URL(r.url).search : "ALARM " + JSON.stringify(o.event).slice(0, 70);
  console.log(new Date(o.eventTimestamp).toISOString().slice(11, 19), o.executionModel.padEnd(13), o.outcome.padEnd(14), "cpu", String(o.cpuTime).padStart(6), "wall", String(o.wallTime).padStart(6), what);
}
