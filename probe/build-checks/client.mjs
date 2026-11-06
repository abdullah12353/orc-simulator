// Throwaway probe for #65 item 2: hold one WebSocket to the world's DO for an hour, ping every 30 s
// (answered by setWebSocketAutoResponse, so the DO stays hibernated), and log every hint the alarms send.
//   node client.mjs <base-url> <out.jsonl> [minutes=63]
import { appendFileSync } from "node:fs";

const [base, out, minutes = "63"] = process.argv.slice(2);
const until = Date.now() + Number(minutes) * 60_000;
const log = (kind, data = {}) => appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), kind, ...data }) + "\n");

let first = true;
let pinger;
function connect() {
  const url = `${base.replace(/^http/, "ws")}/do/ws?name=item2&alarms=${first ? 60 : 0}`;
  first = false;
  const ws = new WebSocket(url);
  ws.addEventListener("open", () => {
    log("open");
    pinger = setInterval(() => { ws.send("ping"); }, 30_000);
  });
  ws.addEventListener("message", (e) => log(e.data === "pong" ? "pong" : "msg", e.data === "pong" ? {} : { data: e.data }));
  ws.addEventListener("error", (e) => log("error", { message: String(e.message ?? e.type) }));
  ws.addEventListener("close", (e) => {
    clearInterval(pinger);
    log("close", { code: e.code, reason: e.reason });
    if (Date.now() < until) setTimeout(connect, 1000);
  });
  setTimeout(() => { if (Date.now() >= until) ws.close(1000, "client done"); }, Math.max(0, until - Date.now()));
}

log("start", { minutes: Number(minutes) });
connect();
setTimeout(() => { log("end"); process.exit(0); }, until - Date.now() + 2000);
