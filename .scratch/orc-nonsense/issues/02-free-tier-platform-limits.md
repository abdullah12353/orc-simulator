# Free-tier platform limits

Type: research
Status: open
Blocked by: (none)

## Question

What hard limits do the free tiers of the chosen stack put on a persistent world that ticks every 1–5 minutes for a handful of friends?

- **Supabase free tier**: project pausing after inactivity (and whether a cron tick counts as activity), database size, Realtime connection and message limits, Edge Function limits, Auth limits.
- **Cloudflare free tier**: Workers Cron Trigger minimum interval and count, CPU time per invocation, request limits, Durable Objects / D1 / KV / R2 availability on the free plan, Pages limits.
- **PWA Web Push**: support on iOS Safari (home-screen install required?), Android Chrome, and desktop. Can a Cloudflare Worker send pushes?
- Which component should own the tick (Cloudflare cron, Supabase pg_cron, or something else) to stay inside free limits and avoid pausing?

Primary sources only (official docs and pricing pages), dated.

## Comments
