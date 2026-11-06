# #58: Durable Object CPU on Workers Free

Run 2026-11-06 on Mohammed's Cloudflare account (Free plan, no card). The Worker `orc-do-cpu-probe` had a
SQLite-backed Durable Object and was **deleted afterwards**. CPU and wall times come from
`wrangler tail --format json` (`cpuTime`, `wallTime`, `outcome`). The full table is in `results.txt`.

The burn is a calibrated loop (`worker.js`). Its "ms" parameter is a target, and real CPU on Cloudflare
came out at about half the target. Every number below is Cloudflare's own `cpuTime`.

## Answer

**The limits table is right. A Durable Object on Free gets about 30 s of CPU per invocation, for both
HTTP requests and alarms.** The FAQ's 10 ms applies to plain Workers, and even there it isn't a clean cap.

## Durable Object

| Invocation | CPU recorded | Outcome |
|---|---|---|
| HTTP | 9, 16, 50, 147, 474, 1,433, 4,817, 21,414 ms | ok |
| HTTP | 32,000 ms | killed (`exceededWallTime`, client gets `1101`) |
| Alarm | 156, 1,463, 8,559 ms | ok |
| Alarm | 32,500 / 32,000 / 30,000 / 30,000 ms | killed (`exceededCpu`), retried |

- SQLite-backed DOs deploy on Free, and **alarms run on Free**, firing about 1 s after `setAlarm`.
- A CPU-killed alarm **is retried** (4 retries seen, ~40 s apart), and each retry is killed again.
  While an attempt burns, the object is single-threaded, so **other requests to it fail** (`1101`).
- **A killed invocation loses its storage writes**, even one made *before* the burn (the "attempt" row
  never persisted). Writes are only durable once the invocation gets past the output gate.

## Plain Worker (control)

- A one-off request ran **1,448 ms of CPU and succeeded**. The next, at ~2,000 ms, was killed (`1102`).
- Under sustained load, though, requests are killed at random, and always at **20 ms CPU**:
  - 3 of 25 requests needing 30–50 ms
  - 2 of 25 requests needing 280–450 ms
- So Free's 10 ms is enforced loosely and probabilistically. Anything over ~20 ms can die at any time.
  That's useless for the tick, and it confirms #50's verdict that a plain Worker can't host it.

## What this means for #54 / #55

- The tick fits inside the world's DO with a lot of headroom: #50 measured a busy week-old world at p50
  27 ms, and `create-world`'s day zero at 200–780 ms. Both are far below 30 s. An alarm can drive it.
- Design for the retry: an over-budget or crashing tick alarm retries and blocks that world's sockets
  while it runs. The tick must be idempotent (its Postgres transaction already is the commit point),
  and any DO-side "next tick due" state must be written in a separate, short invocation, not the one
  doing the work.
- Not measured here: DO **duration** on Free (GB-s per day) and the 100k requests/day shared with
  Workers. #51's estimate stands: ~10–15% of requests, with duration as the risk if sockets can't
  hibernate.
