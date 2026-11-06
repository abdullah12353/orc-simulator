# Off Supabase, onto Neon and a Durable Object per world

Supabase was out (no free project slot, and the budget is $0 with no card on file), so ORC NONSENSE moves to Neon Free and Cloudflare Workers Free. The pieces:
- **Neon Free:** Postgres, Managed Better Auth with magic links, and the Data API.
- **Cloudflare Workers Free:** a thin Worker, a Durable Object per world, KV, a 30-min cron, Workers AI and Pages.

The browser keeps reading Postgres directly under RLS. Everything world-scoped (the tick, `create-world`, `open-edition`, `create-clipping`, narration, pushes, live sockets) runs in the world's Durable Object, behind a Worker that verifies the Neon Auth JWT and routes `/worlds/:id/*`.

The shape is driven by Neon Free's **100 CU-hours a month, with a fixed 5-min scale-to-zero**. The every-minute clock opened a transaction on each call, and on Neon that would burn ~183 CU-h. So "is a tick due, is anyone watching?" lives in Durable Object memory, and unwatched worlds run their 5-min sim steps as backdated catch-up batches every 30 min (~30 CU-h). Durable Objects get ~30 s of CPU per request or alarm on Free, while plain Workers are killed at random above ~20 ms.

## Considered options

- **Neon Functions or Vercel as the tick host** ([#59](https://github.com/abdullah12353/orc-simulator/issues/59)): both are free, but neither can hold "is a tick due?" in memory, so every check wakes Neon.
- **Neon Realtime, or polling, for live hints** ([#55](https://github.com/abdullah12353/orc-simulator/issues/55)): both keep Neon awake and spend its CU-hours.
- **Better Auth self-hosted in a Worker** ([#52](https://github.com/abdullah12353/orc-simulator/issues/52)): more code, Neon woken for session lookups, and a tight CPU budget. It's the fallback if Neon Auth fails us, for example on iOS.
- **Every browser read behind the Worker** ([#53](https://github.com/abdullah12353/orc-simulator/issues/53)): it rewrites ~73 call sites and demotes RLS from the security boundary.

## Consequences

- **Usage guard** ([#54](https://github.com/abdullah12353/orc-simulator/issues/54)): hitting a Neon cap suspends compute until next month, so the guard slows ticks at 80 CU-h and closes the gutter at 95.
- **Catch-up:** gaps of 72 steps (6 h) or fewer are replayed with backdated `now`, and the tick must be idempotent.
- **The `_init` parameter** ([#57](https://github.com/abdullah12353/orc-simulator/issues/57)): on Neon, `auth.uid()` is null inside `security definer` functions on a fresh connection, so every definer function takes an `_init uuid default auth.uid()` parameter, and a test enforces it.
- **iOS deferred:** the session cookie is third-party (on Neon's domain), so iOS Safari PWAs may lose the session. That's deferred until an iOS Player joins.
- **Magic-link mail** goes through a dedicated Gmail account over SMTP, because Resend's free plan needs a domain we don't own.
- **Duration unmeasured:** Durable Object duration (GB-s a day) is measured during the build. If it comes in well over the estimate, watched worlds poll every 30 s instead.

Details are on map [#47](https://github.com/abdullah12353/orc-simulator/issues/47) and its tickets.
