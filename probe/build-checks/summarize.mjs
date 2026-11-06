// Throwaway probe for #65 item 2: sum the GraphQL periodic groups for the hour.
//   node gb-s.mjs <from> <to> periodic > periodic.json && node summarize.mjs periodic.json [objectIdPrefix]
import { readFileSync } from "node:fs";

const [file, prefix = ""] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(file, "utf8")).data.viewer.accounts[0].durableObjectsPeriodicGroups
  .filter((g) => g.dimensions.objectId.startsWith(prefix));
const byObj = {};
for (const g of rows) {
  const o = (byObj[g.dimensions.objectId.slice(0, 12)] ??= { minutes: 0, first: g.dimensions.datetimeMinute, last: null,
    activeTimeS: 0, durationGBs: 0, cpuMs: 0, inWs: 0, outWs: 0, subrequests: 0, maxSockets: 0 });
  o.minutes++;
  o.last = g.dimensions.datetimeMinute;
  o.activeTimeS += g.sum.activeTime / 1e6;
  o.durationGBs += g.sum.duration;
  o.cpuMs += g.sum.cpuTime / 1e3;
  o.inWs += g.sum.inboundWebsocketMsgCount;
  o.outWs += g.sum.outboundWebsocketMsgCount;
  o.subrequests += g.sum.subrequests;
  o.maxSockets = Math.max(o.maxSockets, g.max.activeWebsocketConnections);
}
for (const [id, o] of Object.entries(byObj)) {
  const hours = (Date.parse(o.last) - Date.parse(o.first)) / 3600e3 + 1 / 60;
  console.log(id, JSON.stringify({ ...o, activeTimeS: +o.activeTimeS.toFixed(1), durationGBs: +o.durationGBs.toFixed(2),
    gbsFromActiveTimeAt128MB: +(o.activeTimeS * 0.125).toFixed(2), cpuMs: Math.round(o.cpuMs),
    spanHours: +hours.toFixed(3), gbsPerHour: +(o.durationGBs / hours).toFixed(2), gbsPerDay: Math.round(o.durationGBs / hours * 24) }));
}
console.log("per-minute rows:");
for (const g of rows) console.log(g.dimensions.datetimeMinute, g.dimensions.objectId.slice(0, 8),
  "active", (g.sum.activeTime / 1e6).toFixed(2), "s  GB-s", g.sum.duration.toFixed(3), " cpu", (g.sum.cpuTime / 1e3).toFixed(1),
  "ms  ws in/out", g.sum.inboundWebsocketMsgCount, g.sum.outboundWebsocketMsgCount, " sockets", g.max.activeWebsocketConnections);
