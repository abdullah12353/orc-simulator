# Cloudflare Workers Free for the tick and the three functions

Ticket: [#50](https://github.com/abdullah12353/orc-simulator/issues/50), "Cloudflare Workers free plan for the tick and functions". It sits on the map [#47](https://github.com/abdullah12353/orc-simulator/issues/47).
Researched: 2026-11-05. Every web source was fetched on **2026-11-05**. Freshness is the page's own "last updated" date where it shows one. Primary sources only: Cloudflare, Neon, Deno, Vercel and Netlify docs. Anything the sources don't settle is marked **UNCERTAIN**.
Measurement: `research/workers-free-tick/bench.ts` and `push-bench.ts` on this branch. The raw output is in `run-*.txt` next to them. Facts only: the choices belong to [#54 Tick host and cadence](https://github.com/abdullah12353/orc-simulator/issues/54).

## Answer

- **The tick, as written, does not reliably fit Workers Free's 10 ms CPU cap.**
  - It fits while a world is young or quiet. Measured JS is p50 3.6 ms and p95 6.9 ms, before the driver's own work.
  - Its cost grows with the 7-day Infamy window. In a world kept busy and watched all week, the last day's ticks measured **p50 27 ms, p95 66 ms**.
  - About 60% of that is `stateHash`. The rest is `applyDiff` and loading. All three walk the whole state on every tick, however little happened.
- **`create-world` doesn't fit at all.** Day zero is 288 sim steps in one request: **200–780 ms** of CPU.
- **Web Push is about 4 ms of CPU per push** (encryption plus VAPID signing). In the same invocation as a tick, it eats most of the budget.
- **I/O wait is not billed as CPU.** Cloudflare says so outright.
- **Hyperdrive works on Free** with Neon and postgres.js. It is capped at **100,000 statements a day**, which is about 2 worlds watched round the clock.
- **The cron trigger itself is fine.** 1-minute crons work on Free, and a clock that only does `fetch` uses almost no CPU. That is what `apps/clock` does today.

## 1. Workers Free limits (primary sources)

| Item | Workers Free | Source (freshness) |
|---|---|---|
| CPU per HTTP request | **10 ms** | [Limits](https://developers.cloudflare.com/workers/platform/limits/) (updated 2026-10-29) |
| CPU per Cron Trigger invocation | **10 ms**, the same as HTTP. Paid gets 30 s, or 15 min for intervals of 1 h or more. | Limits |
| Wall time, HTTP | No limit while the client stays connected. `waitUntil()` adds up to 30 s after the response. | Limits |
| Wall time, Cron / Queue consumer / DO alarm | 15 min | Limits |
| Subrequests per invocation | 50 external, 1,000 to Cloudflare services. Unchanged on Free: the Feb 2026 raise was Paid-only. | Limits; [changelog 2026-02-11](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/) |
| Simultaneous outgoing connections | 6 per invocation (`connect()` sockets count) | Limits |
| Memory | 128 MB per isolate | Limits |
| Requests | 100,000 a day, reset at 00:00 UTC. Over the limit returns error 1027. | Limits; [Pricing](https://developers.cloudflare.com/workers/platform/pricing/) (updated 2026-10-02) |
| Cron Triggers | 5 per account. No minimum interval is stated; `* * * * *` is a documented example. | Limits; [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) (updated 2026-10-17) |
| Worker size | 64 MiB uncompressed, and no compressed size limit any more | Limits; [changelog 2026-09-04](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/) |
| Startup | 1 s (error 10021) | Limits |
| `nodejs_compat` | On by default for compatibility dates of 2026-08-04 or later. Earlier dates add the flag. | [Node.js compat](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) (updated 2026-08-12); [changelog 2026-08-04](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/) |
| Hyperdrive | On Free: **100,000 database statements a day**, cached and uncached alike, after which "further operations ... will fail". 10 configs, about 20 origin connections per config, 60 s maximum per statement. | [HD pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/) (2026-06-18); [HD limits](https://developers.cloudflare.com/hyperdrive/platform/limits/) (2026-06-09); [HD FAQ](https://developers.cloudflare.com/hyperdrive/reference/faq/) (2026-07-05) |
| Durable Objects | SQLite-backed only. 100k requests/day, 13,000 GB-s/day, 5M rows read/day, 100k rows written/day, 5 GB in total. | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) (2026-10-18); [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) (2026-10-29) |
| Workflows | 10 ms CPU per step, 3,000 steps a day | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) (2026-11-04) |
| Queues | 10,000 operations a day, 24 h retention (on Free since 2026-02-04) | [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) (2026-10-30) |

### How CPU is counted
- **Waiting on the DB isn't CPU.** The Limits page says: "Waiting on network requests (such as `fetch()` calls, KV reads, or database queries) does **not** count toward CPU time." Only our own JS counts, plus whatever the runtime does on the isolate's thread.
- **There is no averaging or burst allowance, only some slack.** The page says: "Each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit. If your Worker starts hitting the limit consistently, its execution will be terminated." The slack isn't quantified.
- **Going over** gives error 1102, "Worker exceeded resource limits", with outcome `exceededCpu`.
- **Raising `limits.cpu_ms`** is documented for Workers Paid only.
- **`waitUntil()` work belongs to the same invocation.** So the pushes and narration drains that `handleTick` starts after responding count against the same 10 ms. (**UNCERTAIN**: inferred from the docs, not stated per plan.)
- **TLS, SCRAM and Web Crypto:** **UNCERTAIN** whether they count. Nothing says whether a TLS handshake, SCRAM's PBKDF2 or `crypto.subtle` work count toward CPU. They run on the isolate's behalf, so assume they do.

### Postgres from a Worker
- **Hyperdrive on Free, with Neon: yes.** There is a dedicated [Neon guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/) (2026-04-21). It says to use Neon's *direct* connection string with Neon's pooling unchecked.
- **postgres.js through Hyperdrive: supported**, though `pg` is the "recommended driver" ([postgres.js guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/), 2026-10-01). The guide's requirements:
  - postgres.js **3.4.5 or later**. We pin 3.4.7.
  - **Don't set `prepare: false`.** `packages/server/src/db.ts` sets it today, for Supavisor.
  - `max: 5` and `fetch_types: false` are suggested.
- **Hyperdrive pools in transaction mode.** A `BEGIN…COMMIT` holds one connection, which suits `tickWorld`'s single transaction. Transaction-level advisory locks (`pg_advisory_xact_lock`, used by `open-edition`) work; session-level ones don't ([pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/), 2026-08-20).
- **postgres.js runs in Workers.** Its package ships a `workerd` export (`cf/src`, verified in `node_modules/postgres/package.json`). It uses `cloudflare:sockets` and does SCRAM through Web Crypto PBKDF2.
- **TCP `connect()`:** the [TCP sockets page](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) (2026-10-13) sets no plan restriction and says to use Hyperdrive for Postgres. Sockets must be opened inside a handler.
  - **UNCERTAIN**: no page states outright that `connect()` works on Free.
  - **UNCERTAIN**: whether DB queries count as "subrequests". The definition covers fetch and Cloudflare services; `connect()` appears only under the 6-connection limit.
- **Neon's serverless driver** ([neon.com](https://neon.com/docs/serverless/serverless-driver), updated 2026-10-05):
  - HTTP `neon()` supports only *non-interactive* transactions (`sql.transaction([...])`). The tick's read-lock-simulate-write transaction can't use it.
  - The WebSocket `Pool` supports interactive transactions. In Workers it must be created and closed inside each request.

### Cron counts
- **Do cron runs count toward the 100k requests a day?** **UNCERTAIN**, but implied yes: Pricing's Example 3 counts an hourly cron as 720 requests a month. Either way, 1,440 a day is small.
- **Cron triggers per Worker:** the [DO alarms page](https://developers.cloudflare.com/durable-objects/api/alarms/) (2026-04-21) says "up to three Cron Triggers" per Worker, while Limits says 5 per account. **UNCERTAIN**, and it doesn't matter here: we need one.

## 2. Measured: CPU of one tick in Node

**Setup.**
- Machine and runtime: Node 22.14 on an i7-13700H, Windows 11. The machine was **heavily loaded** (90–95% CPU busy from other agents) during the runs.
- Timing method: each tick part runs 3 times on the same input (all are pure functions) and the fastest run counts. That strips out preemption, so the numbers approximate CPU. `process.cpuUsage()` over the run agrees with this: about 3× the timed sum, as expected for 3 repeats plus the Player stand-in.
- The world: day zero, the same as `create-world` (288 unwatched steps, three Players), then 1-minute *watched* ticks.
- Players: three meddle, back and withdraw on a deterministic schedule (the generator from `packages/sim/test/invariants.test.ts`). Intents arrive on about half the ticks.
- After that, 5-minute *unwatched* ticks.

**What each part is:**
- **sim+apply+hash** is exactly what `tick.ts` records as `cpu_ms`: `simulate` + `applyDiff` + `stateHash`.
- **commit JS** builds and JSON-encodes every jsonb parameter the commit sends. That covers `insertFacts` (including `fallbackDialogue` for Clashes), `commitDiff`, `queuePushes` (`pushText`, quiet hours, London date) and `insertTicks`. No DB is involved.
- **load proxy** stands in for `loadState`'s JS: a JSON round trip of the loaded state.

**Not measured:** postgres.js's own wire encoding and row decoding (about 22–30 statements per tick), TLS, and SCRAM. My estimate for the driver is **1–3 ms per tick** (about 30–100 µs per statement). That is an estimate, not a measurement.

### 2a. A world 1–2 days old (10 seeds × 1,440 watched ticks after day zero)

| ms | p50 | p95 | p99 | max |
|---|---|---|---|---|
| `simulate` | 0.11 | 0.97 | 1.34 | 26.4 |
| `applyDiff` | 0.48 | 1.06 | 1.36 | 2.1 |
| `stateHash` | 1.97 | 3.79 | 4.63 | 6.7 |
| **sim+apply+hash (`cpu_ms`)** | **2.7** | **5.3** | **6.7** | 32.0 |
| commit JS | 0.14 | 0.37 | 0.50 | 1.6 |
| load proxy | 0.68 | 1.42 | 1.74 | 3.0 |
| **total measured JS** | **3.6** | **6.8** | **8.7** | 33.8 |

Unwatched 5-minute ticks later in the same runs: total p50 4.6, p95 8.4, p99 9.7 ms. At the end of seed 1 the world was 75 KiB as JSON, with 599 Infamy-window rows and 44 Grudge tags.

**Adding the estimated 1–3 ms of driver work:** p50 is about 5–7 ms and p95 about 8–10 ms. It fits, with no headroom.

### 2b. A world a week old, watched and busy all week (2 seeds × 10,080 watched ticks): the worst case

| ms, last day of the week | p50 | p95 | p99 | max |
|---|---|---|---|---|
| `applyDiff` | 4.6 | 10.9 | 15.1 | 46 |
| `stateHash` | 16.6 | 42.8 | 63.1 | 102 |
| **sim+apply+hash (`cpu_ms`)** | **21.9** | **54.2** | **76.2** | 112 |
| load proxy | 5.1 | 11.4 | 15.7 | 29 |
| **total measured JS** | **27.3** | **66.0** | **88.5** | 130 |

Unwatched ticks after that week: total p50 34.9, p95 55.3 ms. The world had grown to 312 KiB, with **3,244 Infamy-window rows**, 91 Grudge tags and 54 Humiliations.

**Why it grows:**
- `simulate` itself stays small (p50 about 0.2 ms).
- What grows is the whole-state work, and it is proportional to state size, chiefly the 7-day Infamy window: `stateHash` is a stable stringify plus FNV over everything, and `applyDiff` re-filters and re-sorts the windows.
- The window stops growing after 7 days, so this is the plateau for this activity level.
- Real activity is lower. Nobody is watched 24 hours a day, and unwatched ticks make about 0.12 Facts against 0.4 for watched ones. A real world plateaus somewhere between 2a and 2b, scaling with how many Facts it makes in a week.

### 2c. Cold isolate (5 fresh processes, each loading a day-old state and ticking 5 times, no repeats)

| One-off cost in a fresh isolate | Measured |
|---|---|
| First `inQuietHours()` call (`Intl.DateTimeFormat` with a time zone loads ICU zone data) | **39–62 ms**, then 0.2–0.7 ms per call |
| `contentVersion(content)`, the first call per isolate (it hashes the content bundle; cached after) | 11–18 ms |
| Ticks 1–5, total JS each | 18–29, then 10–15, 10–16, 16–30, 10–18 ms (JIT still warming) |
| Module import (Node strips TS at load, so this isn't comparable to a bundled Worker; it falls under the 1 s startup limit, not the 10 ms) | content 104–171 ms, sim 176–241 ms, server+postgres 147–255 ms |
| SCRAM-SHA-256 PBKDF2, 4,096 iterations, via Web Crypto (what postgres.js's Workers build does on every new direct connection) | 5–17 ms |

- In an earlier unsaved warm run without repeats, the first watched tick after day zero cost 29 ms and 39 ms on two of 20 seeds. The `Intl` warm-up is the likely cause.
- **UNCERTAIN**: how long Cloudflare keeps an isolate warm between once-a-minute cron calls. It isn't documented. If isolates are often fresh, every tick pays some of these one-off costs.

### 2d. The other functions

| Function | CPU | Note |
|---|---|---|
| `create-world` | **day zero: p50 276 ms, p95 522 ms, min 200 ms** (10 seeds, `run-warm.txt`); 249 and 778 ms (2 seeds, `run-week.txt`). An earlier unsaved 20-seed run gave p50 399, p95 736, min 179 ms. Encoding the commit adds about 1–2 ms. | Day zero is timed once per seed (no repeats), so it includes load noise. Nothing to tune that brings 288 sim steps under 10 ms. |
| `open-edition` | Not measured: mostly SQL, small JS (ranking, masthead). Estimated low single-digit ms, but it runs `buildMasthead` and London-time formatting, so it can pay the cold `Intl` cost above. | Herald narration waits on a model call: wall time, not CPU. |
| `create-clipping` | Not measured: about 5 queries plus `buildClipping`. Estimated a few ms. | |
| Web Push, per push (`sendPush`: RFC 8291 encryption + VAPID ES256 JWT, fetch faked) | **p50 3.8–4.5 ms, p95 6.7–7.3 ms, first push 42–71 ms** | `push-bench.ts`. Node runs Web Crypto off-thread, so the wall time here may overstate the isolate's CPU. **UNCERTAIN** in Workers. |

## 3. Statement budget if Hyperdrive is used

These counts come from reading `tick.ts`, `commit.ts`, `backing.ts` and `pushes.ts`. They are an estimate, not a trace.

**Per tick:**
- **Idle unwatched call:** about 4 statements (BEGIN, the lock `select`, `isWatched`, COMMIT).
- **Stepped tick with no Facts:** about 22.
- **Typical productive tick:** about 25–35.
- **Worst case:** about 55.
- **Every clock call:** plus 1 for `select id from worlds`.

**Per day:**
- **A world watched all day:** about 1,440 × 25–30, or **36k–43k statements**.
- **An unwatched world on a 1-minute clock:** 288 stepped × about 22 plus 1,152 idle × 4, or **about 11k statements**.

**What that means for the 100k a day:**
- About **2 worlds watched round the clock**, or about 8 unwatched worlds, shared with the three HTTP functions.
- Over the cap, Hyperdrive statements fail until 00:00 UTC.
- Direct TCP to Neon avoids this cap, but every invocation then pays TLS and SCRAM (5–17 ms measured above). Connections can't be reused across invocations.
  - **UNCERTAIN**: that rule (Workers I/O objects can't cross requests) is well-known Workers behaviour, but I didn't find it on the pages fetched here.

## 4. If it doesn't fit: $0, no-card alternatives (facts for #54)

**Separate the clock from the compute.**
- The Cloudflare cron clock (`apps/clock`) only `fetch`es, so it fits Free easily.
- The tick can be an HTTP function anywhere. Cloudflare doesn't count I/O wait, and HTTP wall time is unlimited.

**The cost driver is whole-state work, not the sim.**
- `stateHash` alone is about 55–60% of tick CPU at every world size measured. `applyDiff` plus loading is most of the rest.
- That is a sim/server design question (see the codebase-design skill), not a host question. Changing it is out of scope here: the map says this map doesn't change the sim.

**Splitting `create-world`.**
- Day zero is 288 independent steps, and each step costs what one tick costs.
- It could be chunked across invocations: Queues (10k operations a day), Workflows (10 ms per step, 3,000 steps a day), or chained requests.
- Or it could run on a host with a bigger CPU cap.

**Durable Objects on Free: CPU is ambiguous.**
- The DO limits table says "CPU per request: 30 seconds (default)".
- The same page's FAQ says DOs have "the same per invocation CPU limits as any Workers do", which would be 10 ms on Free.
- **UNCERTAIN**. Worth a throwaway test before anyone relies on it.

**Other hosts:**

| Host | Free CPU / execution | Cron | Card | Source (freshness) |
|---|---|---|---|---|
| Deno Deploy | 1M requests/month and 10 h of active CPU/month, 512 MB. No per-request CPU cap is documented. | `Deno.cron`, every minute allowed | **The changelog (2025-09-26) says Free orgs get "restricted Free plan limits until they verify their organization by linking a credit card."** The restricted limits aren't published. | [pricing](https://deno.com/deploy/pricing) (no date); [cron](https://docs.deno.com/deploy/reference/cron/) (2026-03-02); [changelog](https://docs.deno.com/deploy/changelog/) |
| Vercel Hobby | 300 s max duration, 4 active-CPU-hours/month, 1M invocations/month. **Non-commercial use only.** | Cron once a day; Schedules (beta) every 15 min at most. **No 1-minute cron**, but it can be the HTTP target of the Cloudflare clock. | Not stated for Hobby | [functions limits](https://vercel.com/docs/functions/limitations) (2026-08-24); [Hobby](https://vercel.com/docs/plans/hobby) (2026-09-14); [cron](https://vercel.com/docs/cron-jobs/usage-and-pricing) (2026-07-15) |
| Netlify Free | 300 credits/month with a hard stop (the project pauses). Functions: 60 s sync, 10 credits per GB-hour. | Scheduled functions with a 30 s limit; minimum interval not stated | "You'll never be charged for the Free plan"; nothing says whether a card is needed | [scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/) (2026-10-03); [credit plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/) (2026-10-30) |

## 5. Risks and open questions for #54

1. **Tick CPU scales with world activity over the last 7 days**, not with the tick. A world that's fine in week one can start failing with error 1102 in week two. The "infrequent overrun" slack is unquantified.
2. **Hardware gap.** These numbers come from a fast laptop CPU under load. Cloudflare's per-core speed relative to it is unknown. A throwaway deploy that reads `cpu_ms` and the Workers CPU metrics would settle it.
3. **Cold isolates.** `Intl` zone data (40–60 ms), the `contentVersion` hash (11–18 ms) and a cold JIT all land on the first tick in an isolate. Isolate lifetime isn't documented.
4. **`create-world` needs 20–80× the Free cap.** It needs a different host, or chunking.
5. **Pushes and narration drains** run in `waitUntil` in the tick's own invocation today. About 4 ms per push would share the tick's 10 ms.
6. **Hyperdrive's 100k statements a day** caps the number of busy worlds. `db.ts`'s `prepare: false` must go under Hyperdrive.
7. **UNCERTAIN items:**
   - DO CPU on Free (30 s or 10 ms).
   - Whether DB queries count as subrequests.
   - Whether `connect()` is explicitly allowed on Free.
   - Whether TLS, SCRAM and Web Crypto count as CPU.
   - Deno Deploy's limits without a card.
   - Netlify's minimum cron interval.
