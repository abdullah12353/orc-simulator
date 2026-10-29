# Free-tier platform limits

Type: research
Status: resolved
Blocked by: (none)

## Question

What hard limits do the free tiers of the chosen stack put on a persistent world that ticks every 1–5 minutes for a handful of friends?

- **Supabase free tier**: project pausing after inactivity (and whether a cron tick counts as activity), database size, Realtime connection and message limits, Edge Function limits, Auth limits.
- **Cloudflare free tier**: Workers Cron Trigger minimum interval and count, CPU time per invocation, request limits, Durable Objects / D1 / KV / R2 availability on the free plan, Pages limits.
- **PWA Web Push**: support on iOS Safari (home-screen install required?), Android Chrome, and desktop. Can a Cloudflare Worker send pushes?
- Which component should own the tick (Cloudflare cron, Supabase pg_cron, or something else) to stay inside free limits and avoid pausing?

Primary sources only (official docs and pricing pages), dated.

## Answer

Full findings: `research/free-tier-platform-limits.md` on branch [`research/free-tier-platform-limits`](https://github.com/abdullah12353/orc-simulator/blob/research/free-tier-platform-limits/research/free-tier-platform-limits.md) (never merged).

- **The free stack holds** for a 1-minute worst-case tick (about 44.6k ticks a month), provided the design follows the constraints below.
- **Tick owner:** a Cloudflare Worker on a Cron Trigger every minute. It ticks when a Player was seen recently (`last_seen`), and otherwise only every 5 minutes. Supabase stays the canonical store.
- **Pausing:** Supabase pauses after about a week without "sufficient" activity, which it never defines. External API calls on each tick should count. pg_cron is *not* a safe keep-alive, because it stops when the project pauses.
- **Realtime:** quota is 2M messages a month, and each listening client counts separately. Send **one broadcast per tick** and have clients refetch. Do not stream row changes.
- **Workers Free:** 10 ms CPU per call, 50 outgoing requests per call, 100k requests a day. If a tick doesn't fit in 10 ms, run it in a Supabase Edge Function (2 s CPU) or a Postgres function.
- **KV** allows only 1k writes a day, so it's not for tick state. Durable Objects and D1 are available on Free as a fallback.
- **Auth:** Supabase's built-in email sends only 2 an hour. Use OAuth or custom SMTP.
- **Web Push:** iOS needs 16.4 or later *and* the app added to the Home Screen. Every push must show a notification. Pushes can be sent from a Worker (VAPID, e.g. `@pushforge/builder`), but this is untested.
- **Open risks:** the vague pause rule, and whether a tick plus pushes fits in 10 ms of CPU. → feeds [Narration tiers and tick budget](11-narration-tiers-and-tick-budget.md)

## Comments
