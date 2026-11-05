# Other $0 hosts for the tick: Neon Functions and Vercel Hobby

Ticket: [#59](https://github.com/abdullah12353/orc-simulator/issues/59), "Other $0 hosts for the tick: Neon Functions and Vercel". It sits on the map [#47](https://github.com/abdullah12353/orc-simulator/issues/47) and blocks [#54 Tick host and cadence](https://github.com/abdullah12353/orc-simulator/issues/54).
Researched: 2026-11-05. Every web source was fetched on **2026-11-05**. Freshness is the page's own "last updated" date. Primary sources only: Neon and Vercel docs, pricing pages, changelog and blog. Anything the sources don't settle is marked **UNCERTAIN**.
Measured costs come from [#50](https://github.com/abdullah12353/orc-simulator/issues/50) ([findings](https://github.com/abdullah12353/orc-simulator/blob/research/workers-free-tick/research/workers-free-tick.md)) and the Neon compute model from [#48](https://github.com/abdullah12353/orc-simulator/issues/48) ([findings](https://github.com/abdullah12353/orc-simulator/blob/research/neon-free-tier/research/neon-free-tier.md)). This is facts only. The choices belong to #54.

## Answer

- **Both hosts can run the tick and `create-world` as written, at $0 and with no card.** Neither has a per-invocation CPU cap anywhere near the tick's cost. Both run real Node.js with TCP, so postgres.js can talk to Neon's pooler directly. Both budget CPU per month, not per call.
  - **Neon Functions (Free):** 10 active Capacity-Hours (CH), 400 waiting CH and 1M invocations per project per month. Each call may take up to 15 min to first byte, and `waitUntil` work may run up to 15 min. Node.js 24, 2 GiB, Frankfurt available. A once-a-minute call gets an average of **~806 ms active and ~32 s waiting**.
  - **Vercel Hobby:** 4 Active-CPU hours, 360 GB-hours of provisioned memory and 1M invocations per month. Max duration 300 s, a fixed 2 GB / 1 vCPU, one region (Frankfurt `fra1` can be chosen). A once-a-minute call gets an average of **~322 ms Active CPU and ~14.5 s alive**.
  - Against the measured tick (p50 3.6–27 ms, p95 66 ms per world), `create-world` (200–780 ms, rare) and Web Push (~4 ms each), both have room for several busy worlds. Neon has about 2.5× Vercel's CPU headroom.
- **Neon Functions can own the clock.** Schedule triggers accept `* * * * *` and fire while Postgres is scaled to zero. The trigger itself doesn't wake Postgres, but any query the handler makes does. So #48's condition (decide "is a tick due / is anyone watching?" off Postgres) still applies. Catches: delivery is at-least-once and can arrive out of order, trigger calls arrive with no credentials, and Functions usage doesn't appear in the Console usage summary.
- **Vercel can't own the clock on Hobby.** Cron Jobs run at most once a day, and Schedules (beta) at most every 15 min with a 15-min jitter window. Vercel works as the **HTTP target of the Cloudflare cron clock**, which is the D39 shape `apps/clock` already has.
- **Vercel Hobby is "non-commercial personal use only".** Vercel defines commercial as financial gain for anyone involved in making the project, for example payments, ads, selling or paid developers. A private friend-group game with none of those matches none of Vercel's examples. Whether a per-minute external caller counts as "circumventing" Hobby's schedule limits isn't addressed (**UNCERTAIN**).
- **What happens at a cap differs.** Neon suspends Postgres until the next month when CU-hours or egress run out. What happens when the *Functions* allowance runs out isn't documented. On Vercel Hobby, an exceeded limit usually means waiting **30 days** before you can use the feature again.

## 1. Neon Functions (Free plan)

GA on 2026-09-18 as part of the backend GA ([changelog 2026-09-18](https://neon.com/docs/changelog/2026-09-18)).

| Item | Fact | Source (freshness) |
|---|---|---|
| Free allowance | **10 active CH, 400 waiting CH, 1M invocations per project per month.** Each project has its own allowance. | [Plans](https://neon.com/docs/introduction/plans#functions) (2026-11-04) |
| What a CH is | "Functions run at a fixed size, so one hour of function runtime equals one Capacity-Hour." Active is billed "while your code is actively using the CPU". Waiting is billed at a lower rate "when your code isn't using much CPU, typically while it waits on the network, a timer, or other I/O". "A single request usually incurs both." The CPU threshold and the metering granularity aren't stated (**UNCERTAIN**). | Plans |
| When billing runs | From the moment a request triggers the function until it returns its response or finishes any `waitUntil` work. Nothing between requests. Whether a cold microVM boot is billed isn't stated (**UNCERTAIN**). | Plans |
| Invocations | Each call is one invocation, whatever its length. Trigger retries are billed like other invocations. | Plans; [Triggers](https://neon.com/docs/compute/functions/triggers/overview) (2026-10-20) |
| Relation to Postgres CU-hours | Functions are metered separately, in CH. The plans page bills them apart from the 100 CU-hours and never says they draw from them. | Plans |
| Keeps Postgres awake? | No. "A query to a Postgres compute that has scaled to zero wakes that compute too", so a function only wakes Postgres when it queries it. | Triggers |
| Egress | Counts toward the project's shared 5 GB/month public network transfer, together with Postgres and Object Storage. | Plans |
| At the cap | Free plan FAQ: running out of CU-hours or network transfer suspends compute until next month. What happens when the **Functions** CH or invocation allowance runs out isn't stated (**UNCERTAIN**). | Plans |
| Visibility | "Extra branches, Neon Functions, and Object Storage don't appear in the Console usage summary." | Plans |
| Card | The Free plan is $0 with no credit card. | [Pricing](https://neon.com/pricing); #48 |
| Runtime | **Node.js 24**, one microVM per isolate. JS/TS only. Memory is **2048 MiB**, fixed. No CPU-time or vCPU limit is published. | [Runtime limits](https://neon.com/docs/compute/functions/reference/runtime-limits) (2026-09-16); [Overview](https://neon.com/docs/compute/functions/overview) (2026-11-02) |
| Timeouts | Up to **15 min to first byte**, a 15-min stream heartbeat, and **`waitUntil` up to 15 min** after the response (`import { waitUntil } from '@neon/functions'`). | Runtime limits |
| Lifecycle | Shut down when idle ("no open connections or pending `waitUntil` work"), and may be evicted at any time. Module state is lost on eviction. The idle timeout isn't stated (**UNCERTAIN**). On stop it sends SIGINT, then a hard kill 5 s later. | Runtime limits |
| Concurrency | Several requests share one isolate, with more isolates under load. The default is **100 concurrent invocations per account**, after which it returns `429`. | Runtime limits |
| Regions | `aws-us-east-2`, `aws-us-east-1`, **`aws-eu-central-1` (Frankfurt)**, `aws-ap-southeast-1`. "Create your project in one of these regions to use them." A function runs in its branch's region. | Overview |
| Deploy | `neon deploy` (from `neon.ts`) or `neon functions deploy <slug> --src <file>`. The CLI **bundles with esbuild** (`--platform=node --target=node24 --format=esm`). With `--no-bundle` the entry must be `index.js`/`index.mjs` ("TypeScript can't ship unbundled"). Builds get a 2-min budget. | [Deploy](https://neon.com/docs/compute/functions/deploy) (2026-10-24) |
| Database | `DATABASE_URL` is injected as the **pooled** string, plus `DATABASE_URL_UNPOOLED`. Neon advises a long-lived `pg` `Pool` at module scope, and *not* the serverless driver. postgres.js isn't mentioned (see §3). | [Get started](https://neon.com/docs/compute/functions/get-started) (2026-11-02); [Env vars](https://neon.com/docs/compute/functions/environment-variables) (2026-10-23) |
| Env vars | Your own variables are set with `--env` or in `neon.ts`. Total size is capped at 32 KiB, including the injected ones. | Env vars |
| Auth | Every function has a public URL with "no platform gate". Check a shared secret or verify a Neon Auth JWT against the injected JWKS yourself. | [Authentication](https://neon.com/docs/compute/functions/authentication) (2026-09-16) |

### 1.1 Schedule triggers (as the clock)

| Item | Fact | Source (freshness) |
|---|---|---|
| Cadence | Five-field numeric cron, always **UTC**, "down to every minute, with no maximum interval". There are no seconds, names or macros. | [Schedule a function](https://neon.com/docs/compute/functions/triggers/schedule) (2026-10-20) |
| Scale to zero | "Fires even when the compute is scaled to zero", with "no compute kept running to watch for the event". | Schedule; Triggers |
| Request shape | A `POST` with a JSON body (`data.scheduled_at`, `trigger`, `invocation_id`, `previous_attempts`) and an `X-Neon-Trigger-Invocation-Id` header. Neon strips client-set `X-Neon-*` headers, so the header's presence proves the call came from Neon. "Scheduled invocations arrive without credentials." | Schedule; Triggers |
| Delivery | Non-2xx responses (including `429` and redirects) and crashes are retried "a few times, up to 72 hours". Delivery "can happen more than once" and "can arrive out of order". A `503` + `Retry-After` (1–900 s) asks for a later retry. | Triggers |
| Branches | A child branch inherits its parent's triggers **disabled**. | Triggers |
| Billing | Billed like other invocations. No separate trigger charge. | Triggers; [Plans](https://neon.com/docs/introduction/plans) |

## 2. Vercel Hobby functions (as the Cloudflare clock's HTTP target)

| Item | Fact | Source (freshness) |
|---|---|---|
| Free allowance | **4 Active-CPU hours, 360 GB-hours provisioned memory, 1M invocations a month.** Also 100 GB fast data transfer. | [Hobby plan](https://vercel.com/docs/plans/hobby) (2026-09-14); [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing) (2026-06-16) |
| Active CPU | "The CPU time your code actively consumes in milliseconds". Not billed while waiting on I/O. | Fluid compute pricing |
| Provisioned memory | Billed for the instance's lifetime while any request is in flight, including I/O waits. "After all requests complete, the instance is paused", so nothing is billed between requests. | Fluid compute pricing |
| Invocations | Every request counts, "regardless of request success or failure". | Fluid compute pricing |
| Memory / CPU size | Hobby: **2 GB / 1 vCPU, default and maximum** ("Standard" CPU). Only Pro can configure it. | [Limits](https://vercel.com/docs/functions/limitations) (2026-08-24); [Fluid compute](https://vercel.com/docs/fluid-compute) (2026-08-24) |
| Duration | Hobby: **300 s default and maximum** (Node, Bun, Python). There is no separate CPU-per-call cap. | Limits; Fluid compute |
| Fluid compute | On by default for new projects since 2025-04-23. Several invocations share one instance. `waitUntil` covers post-response work. Bytecode caching and pre-warming apply to production deployments. | Fluid compute |
| Concurrency | Auto-scales up to 30,000 (Hobby and Pro). | Limits |
| Region | Hobby gets a **single region**. The default is `iad1` (Washington) and can be changed in project settings or `vercel.json` `"regions"`. **`fra1` = AWS `eu-central-1`, Frankfurt**, the same AWS region as Neon's Frankfurt. | [Region config](https://vercel.com/docs/functions/configuring-functions/region) (2026-08-11); [Regions](https://vercel.com/docs/regions) (2026-08-11) |
| Runtime | Node.js runtime with "full Node.js coverage". Node 24 LTS is GA. TypeScript in `/api` works with most `tsconfig` options, except path mappings and project references. `.ts`-extension imports and workspace packages whose `exports` point at `.ts` aren't mentioned (**UNCERTAIN**). Pre-bundling sidesteps that (§3). | [Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js) (2026-08-11); Limits |
| Native scheduling | **Cron Jobs (legacy):** Hobby gets once per day, ±59 min. More frequent expressions fail at deploy. **Schedules (beta):** Hobby gets at most **every 15 min**, always with a 15-min jitter window, and 5,000 runs per billing period. Over the limit, runs are skipped until the next period. | [Cron Jobs pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) (2026-07-15); [Schedules](https://vercel.com/docs/schedules) (2026-10-26); [Schedules limits](https://vercel.com/docs/schedules/limits) (page shows "2018-10-20", clearly wrong. **UNCERTAIN**) |
| At the cap | "In most cases, if you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have passed before you can use the feature again." Hobby has no spend management. | Hobby plan |
| Logs | Runtime logs are kept 1 hour on Hobby. | Hobby plan; [Limits](https://vercel.com/docs/limits) (2026-09-16) |
| Commercial use | "Hobby teams are restricted to non-commercial personal use only." Commercial use means a deployment "used for the purpose of financial gain of **anyone** involved in **any part of the production**", for example taking payments, advertising products, being paid to build or host it, affiliate-led sites, or ads. Donations don't count. "If you are unsure … contact the Vercel Support team." Also: "Circumventing or otherwise misusing Vercel's limits or usage guidelines is a violation." Whether an outside caller hitting a function every minute counts as circumventing the schedule limit isn't addressed (**UNCERTAIN**). | [Fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines) (2026-09-14) |
| Card | Card details appear only in the steps for upgrading to Pro. Hobby is "free". | Hobby plan |

## 3. Does our code run there? (repo facts plus one throwaway check)

What runs today:
- `supabase/functions/tick/index.ts` and `create-world/index.ts` are thin **Deno** wrappers: `Deno.env`, `Deno.serve` and `EdgeRuntime.waitUntil`. They wrap `handleTick` and `handleCreateWorld` from `packages/server`.
- `packages/server` is TypeScript with explicit `.ts` relative imports (`./commit.ts`). It imports the workspace packages `@orc/content` and `@orc/sim`, whose `exports` point at `src/index.ts`. It uses **postgres.js 3.4.7** (`connect()` in `db.ts`: `prepare: false`, `max: 1`).
- `handleTick` (`packages/server/src/http.ts`) **requires `Authorization: Bearer <TICK_SECRET>`** and returns 401 otherwise. With no body it calls `tickAllWorlds`. That reads `select id from worlds`, then runs one transaction per world, each starting with `FOR UPDATE NOWAIT` and `isWatched` (`tick.ts`). So **every call queries Postgres, even an idle one**, which is #48's finding. Pushes and narration then run in `waitUntil`.
- `apps/clock` is a Cloudflare Worker on `* * * * *` that POSTs `TICK_URL` with the bearer secret.

**Throwaway check (not committed).** I wrapped `handleTick` and `handleCreateWorld` in a Neon-shaped `export default { fetch }` handler. Then I bundled it with esbuild 0.28.2, using the flags Neon's CLI uses (`--bundle --platform=node --target=node24 --format=esm`):
- The build succeeds. The output is a **352 KB ESM file**. It resolves the `.ts`-extension imports and all three workspace packages.
- The only Node built-ins it imports are `net`, `tls`, `crypto`, `fs`, `os` and `stream`, which come from postgres.js.
- The bundle loaded in Node 22.14 and answered a POST with no secret with `401 {"error":"unauthorized"}`.
- It hasn't been deployed to either host.

What this means:

| Question | Neon Functions | Vercel Hobby |
|---|---|---|
| Build the TS | The CLI bundles with esbuild, and the check above shows our tree bundles. | Vercel's own TS build of `.ts`-extension imports isn't documented (**UNCERTAIN**). Pre-bundling with esbuild into `api/*.mjs`, or using the Build Output API, gives the same artifact the check built. |
| postgres.js over TCP | Neon's own example uses `pg` over TCP to the pooled `DATABASE_URL`. postgres.js uses the same `net`/`tls` APIs, so it's expected to work but isn't named (**UNCERTAIN until deployed**). The pooler is PgBouncer transaction mode, so keep `prepare: false` (#48). Neon's `attachDatabasePool` is `pg`-specific. How postgres.js handles the pooler dropping idle sockets is untested (**UNCERTAIN**). | "Full Node.js coverage", so TCP to Neon's pooler is the same as above. There's no Hyperdrive here, so the 100k statements/day cap from #50 doesn't apply. Each cold instance pays TLS + SCRAM (5–17 ms in #50). |
| Entry point | Swap the Deno wrapper for `export default { fetch }` and `@neon/functions` `waitUntil`. A trigger call carries no bearer token, so `handleTick` as written would answer it **401**. A trigger-only entry would check `X-Neon-Trigger-Invocation-Id` instead (Neon's documented pattern). | Swap the wrapper for a Node/Web handler and `@vercel/functions` `waitUntil`. The Cloudflare clock's bearer secret works unchanged. |
| Duplicates | A redelivered or out-of-order trigger call is just another tick call: `handleTick` uses `now()`, not `scheduled_at`. A watched world would step an extra time. The world row lock (`NOWAIT`) keeps two calls from overlapping. | Cloudflare cron's delivery is unchanged from today. |
| `Intl` time zones | The tick uses Europe/London. Node 24's ICU data on Neon isn't documented (**UNCERTAIN**, though official Node builds ship full ICU). | Same, not documented (**UNCERTAIN**). |

## 4. Fit against the measured cost

Assumptions: a 31-day month is **44,640** one-minute calls. Measured CPU comes from #50, taken on an i7-13700H laptop. Neither host publishes how its CPU speed compares (**UNCERTAIN**). Per-world tick cost is **p50 3.6 ms** (1–2-day-old world) to **p50 27 ms / p95 66 ms** (busy, watched for a week). A cold isolate adds roughly 70–110 ms: `Intl` 40–60 ms, the `contentVersion` hash 11–18 ms, and the first ticks 18–29 ms. `create-world` is 200–780 ms once per world. Web Push is ~4 ms each.

| Budget per month | Neon Functions Free | Vercel Hobby |
|---|---|---|
| CPU | 10 active CH = 36,000 s, **≈806 ms per one-minute call** | 4 h = 14,400 s, **≈322 ms per one-minute call** |
| Wall / alive time | 400 waiting CH = 1.44M s, **≈32 s per call** | 360 GB-h ÷ fixed 2 GB = 180 instance-hours, **≈14.5 s alive per call** (if calls don't overlap) |
| Invocations | 1M. The clock uses 44,640 (4.5%). | 1M. The clock uses 44,640 (4.5%). |
| Busy watched worlds that fit if all of them tick every minute all month, at p95 66 ms + ~5 ms driver each | ≈11 | ≈4 |
| Same at p50 27 ms + ~5 ms | ≈25 | ≈10 |
| One call's ceiling | 15 min to first byte, 15 min `waitUntil` | 300 s in total |
| `create-world` 780 ms | Fits easily (one call). | Fits easily (one call). |

These rows are a worst case. In practice, worlds are watched for only part of the day, and unwatched worlds step every 5 min or slower (whatever #54 picks). Idle calls cost only the driver's few ms per world, plus the Postgres wake that #48 measured. The waiting and alive budgets also have to cover narration's LLM calls, which run in `waitUntil` after a stepped tick. A Neon Postgres wake ("a few hundred ms", #48) counts as waiting or alive time, not CPU.

## 5. The Postgres-awake question (applies to both)

- Neither host keeps Neon's compute awake on its own. Only queries do.
- A Neon schedule trigger is the only timer here that runs *inside* Neon's platform without waking Postgres. But the handler then has to decide "is anything due?" without querying Postgres, or #48's ~183 CU-h result comes back.
- A function can't keep that decision in memory, because isolates are evicted when idle and the timeout isn't documented. The candidates for holding it off Postgres are a Cloudflare Durable Object (#51), Neon Object Storage (5 GB free, "no per-operation charge" on paid plans; whether in-region function reads count as egress isn't stated, **UNCERTAIN**), or the trigger cadence itself. That choice is #54's.
- With Vercel as the target, the Cloudflare clock (or a DO it consults) has to make the same decision before it calls.

## 6. Risks

- **Neon Functions:**
  - Usage is invisible in the Console usage summary.
  - What happens when the Functions allowance runs out is undocumented.
  - The active-CPU threshold is undefined.
  - Cold-boot billing and the eviction timeout are undocumented.
  - Account concurrency is 100.
  - It is only in four regions. **The Neon project must be created in `aws-eu-central-1` (or another Functions region), or Functions aren't available at all.** Neon Realtime (beta) has the same four regions (#49).
  - The product is two months past GA, and the CLI's Functions commands "are new and change often".
- **Vercel Hobby:**
  - A **30-day lockout** if a limit is exceeded, with no spend controls.
  - The "non-commercial" and "circumventing limits" wording is open to Vercel's reading.
  - The memory size is fixed at 2 GB.
  - Logs last 1 hour.
  - It adds a third vendor (Cloudflare clock, Vercel tick, Neon DB).
  - The region must be changed from the `iad1` default to `fra1`.
- **Both:**
  - Host CPU speed relative to the measurements is unknown.
  - postgres.js hasn't been deployed on either host.
  - Tick CPU grows with 7-day activity (#50).
