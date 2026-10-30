// Local stand-in for the clock Worker: POSTs the local tick endpoint on an interval, exactly as the
// Worker does in production. `npm run dev:clock` (every 60 s) or `npm run dev:clock -- 5` (every 5 s).
const seconds = Number(process.argv[2] ?? 60);
const url = process.env.TICK_URL ?? 'http://127.0.0.1:55421/functions/v1/tick';
const secret = process.env.TICK_SECRET ?? 'local-tick-secret'; // matches supabase/config.toml

async function tick() {
  try {
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
    const body = await res.json().catch(() => ({}));
    const summary = (body.outcomes ?? []).map((o) => `${o.worldId.slice(0, 8)}:${o.status}${o.factCount ? `+${o.factCount}` : ''}`);
    console.log(new Date().toISOString(), res.status, summary.join(' ') || JSON.stringify(body));
  } catch (e) {
    console.error(new Date().toISOString(), 'tick failed:', e.message);
  }
}

console.log(`ticking ${url} every ${seconds}s (Ctrl+C to stop)`);
await tick();
setInterval(tick, seconds * 1000);
