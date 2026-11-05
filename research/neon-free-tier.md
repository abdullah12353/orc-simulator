# Neon free tier against our load

Ticket: [#48 Neon free tier against our load](https://github.com/abdullah12353/orc-simulator/issues/48), on the map [#47](https://github.com/abdullah12353/orc-simulator/issues/47).
Researched: 2026-11-05. Every web source was read on **2026-11-05**. Each one is listed with its own "Last updated" date, which shows how fresh it is.
Sources are Neon's own pricing page and docs. Anything those pages don't settle is marked **UNCERTAIN**. Repo facts come from `main` at `d23ba1e`.

## Verdict

**Yes, but only if unwatched worlds stop touching Postgres more often than about every 15 minutes.** The Free plan is $0 with no card. It gives 100 CU-hours per project per month, which is about 400 awake hours at 0.25 CU. Today the clock calls the tick every minute, and every call runs a transaction (lock plus the `isWatched` query), even when the world is idle. Under Neon's 5-minute scale-to-zero, that keeps the compute awake all month: 730 h × 0.25 CU ≈ **183 CU-hours, 1.8× the allowance**. The 5-minute unwatched cadence doesn't help on its own, because a 5-minute gap never reaches the 5-minute suspend delay. At the cap, Neon doesn't throttle and doesn't bill. It **suspends the compute until the next billing period**, so the game would go dark for the rest of the month.

Everything else fits:
- The pooler is PgBouncer in transaction mode, so postgres.js with `prepare: false` works unchanged.
- `pgcrypto` and `gen_random_uuid` are available.
- RLS, `CREATE ROLE` and `security definer` are plain Postgres and work.
- The Supabase-only pieces (`auth.*`, `realtime.*`, the `anon`/`authenticated`/`service_role` roles, the `extensions.` schema prefix) don't exist on Neon. They are work for the migrations-rewrite ticket.

---

## 1. Free plan limits

| Fact | Source (last updated) |
|---|---|
| $0/month. "The Free plan is permanent (not a trial); no credit card required." | [Pricing](https://neon.com/pricing) (2026-10-31) |
| **Compute: 100 CU-hours per project per month.** Each project has its own allowance. "Enough for a 0.25 CU compute running 400 hours/month." CU-hours = compute size × hours running (for example, 2 CU for 3 h = 6 CU-h). Compute and network transfer reset each billing period. | [Plans](https://neon.com/docs/introduction/plans) (2026-11-04), [Free plan FAQ](https://neon.com/faqs/free-plan-limits-and-quotas) (2026-10-01) |
| 1 CU ≈ 4 GB RAM, plus CPU and local SSD. Sizes start at 0.25 CU (1 GB). Free autoscaling goes "up to 2 CU (8 GB RAM)". | [Plans](https://neon.com/docs/introduction/plans), [Manage computes](https://neon.com/docs/manage/computes) (2026-11-05) |
| **UNCERTAIN: the minimum size and default autoscaling range for a Free compute, and whether Free can pin a fixed 0.25 CU.** No page states these. "Larger computes consume more compute hours over the same period of active time." So if the compute autoscales above 0.25 CU during ticks, the 400-hour figure shrinks proportionally. Check the range in the console on the first deploy. | [Manage computes](https://neon.com/docs/manage/computes), [Autoscaling](https://neon.com/docs/introduction/autoscaling) (2026-06-05) |
| **Scale to zero: suspends after 5 minutes of inactivity.** On Free it "cannot disable" and can't be configured. Paid plans can disable it, and Scale can lower it to 1 min. | [Plans](https://neon.com/docs/introduction/plans), [Scale to zero](https://neon.com/docs/introduction/scale-to-zero) (2026-11-04) |
| **What counts as inactive:** "no active queries for 5 minutes". An idle-in-transaction connection counts as active. The page implies that an idle open connection doesn't keep the compute awake ("only the truly inactive connections are closed"), but doesn't say so outright (**UNCERTAIN**). Nothing says whether pooler-held server connections, Hyperdrive pool health checks, or console and monitoring queries count. | [Compute lifecycle](https://neon.com/docs/introduction/compute-lifecycle) (2026-09-16) |
| **Cold start:** "generally takes a few hundred milliseconds". It may be "slightly longer" after more than 7 days idle, and the first queries are slower until the buffers warm. Neon publishes no harder number. | [Compute lifecycle](https://neon.com/docs/introduction/compute-lifecycle), [Connection latency](https://neon.com/docs/connect/connection-latency) |
| On suspend, connections close and session state is lost: session parameters, temporary tables, prepared statements, advisory locks, `LISTEN`. | [Compute lifecycle](https://neon.com/docs/introduction/compute-lifecycle) |
| **Free projects are not paused for inactivity.** Compute restarts on the next query. There is no 7-day pause like Supabase's. | [Pricing](https://neon.com/pricing) |
| **Storage: 1 GB per project, 20 GB across all Free projects.** 100 projects. 10 branches per project, including the root branch. | [Pricing](https://neon.com/pricing), [Plans](https://neon.com/docs/introduction/plans) |
| **Egress: 5 GB per project per month** of public network transfer. Postgres, Object Storage and Functions share it. | [Plans](https://neon.com/docs/introduction/plans) |
| History and restore: a 6 h window, capped at 1 GB of change history. 1 manual snapshot, no scheduled snapshots. Monitoring keeps 1 day. Community support only. No spending notifications. | [Pricing](https://neon.com/pricing), [Plans](https://neon.com/docs/introduction/plans) |

### What happens at each cap

| Cap | Behaviour | Source |
|---|---|---|
| 100 CU-hours **or** 5 GB egress | **Compute suspended until the next billing period** or an upgrade. "Existing connections drop and new ones can't open." No throttling and no overage billing on Free. | [Pricing](https://neon.com/pricing), [Plans](https://neon.com/docs/introduction/plans), [Free plan FAQ](https://neon.com/faqs/free-plan-limits-and-quotas) |
| 1 GB storage per project (or 20 GB total) | Writes that increase storage fail. The page lists inserts, updates and deletes. | [Plans](https://neon.com/docs/introduction/plans) |
| 10 branches | Creating a branch fails. | [Plans](https://neon.com/docs/introduction/plans) |
| All caps | No data is deleted. Upgrading lifts the limit at once. | [Pricing](https://neon.com/pricing) |

---

## 2. Pooler and drivers

### 2.1 PgBouncer pooler with postgres.js

| Fact | Source (last updated) |
|---|---|
| The pooler is **PgBouncer** in `pool_mode=transaction`. Use the pooled host by adding `-pooler` to the endpoint ID (`ep-…-pooler.<region>.aws.neon.tech`). | [Connection pooling](https://neon.com/docs/connect/connection-pooling) (2026-10-19) |
| `max_client_conn=10000`. `default_pool_size = 0.9 × max_connections`. `max_connections` at 0.25 CU is 104, with 7 reserved for Neon, leaving 97. `query_wait_timeout=120` s. These settings aren't user-configurable. | same |
| Not supported on pooled connections: `SET`/`RESET`, `LISTEN`/`NOTIFY`, `WITH HOLD` cursors, SQL-level `PREPARE`/`DEALLOCATE`, temp tables with `PRESERVE`/`DELETE ROWS`, `LOAD`, and **session-level** advisory locks. **Protocol-level prepared statements are supported** (PgBouncer ≥ 1.22, `max_prepared_statements=1000`). | same |

What our server code does (`packages/server/src`):
- `db.ts` opens postgres.js with `prepare: false`, so it uses unnamed statements only. That's what transaction mode needs. Neon's PgBouncer also tracks named protocol-level statements, so even `prepare: true` would likely work. That's an inference, not tested.
- The tick runs inside one `sql.begin` transaction. It uses `FOR UPDATE NOWAIT`, `FOR UPDATE SKIP LOCKED` and `for update of pp`, and all of these are transaction-scoped.
- `herald.ts` uses `pg_advisory_xact_lock`, which is **transaction-level** and therefore allowed. Only session-level advisory locks are excluded.
- Nothing in `packages/server/src` uses `SET`, `LISTEN`/`NOTIFY` or SQL `PREPARE`.
- Verdict: **works unchanged through the Neon pooler**. The only change is the comment in `db.ts` that names Supavisor.

### 2.2 Connecting from Cloudflare Workers

| Fact | Source (last updated) |
|---|---|
| Neon's Workers guide **recommends Hyperdrive**, "included in all Workers plans", with native drivers. It names `pg` and "Postgres.js", but its example uses `pg` with `nodejs_compat`. With Hyperdrive, use the **direct** (non-pooler) string, because "Hyperdrive manages connection pooling". Use a dedicated role, and set `localConnectionString` for `wrangler dev`. Don't use the serverless driver with Hyperdrive. | [Neon + Cloudflare Workers](https://neon.com/docs/guides/cloudflare-workers) (2026-10-09) |
| The serverless driver is the alternative. Use the **pooled** string with it. | same |

Hyperdrive's own Free-plan limits are Cloudflare's to state and belong to the Cloudflare tickets.

### 2.3 `@neondatabase/serverless`

| Fact | Source (last updated) |
|---|---|
| **HTTP mode (`neon()`)**: one fetch per query, recommended for single queries and **non-interactive** transactions (`sql.transaction([...])`). Requests and responses can be up to 64 MB. | [Serverless driver](https://neon.com/docs/serverless/serverless-driver) (2026-10-05) |
| **WebSocket mode (`Pool`/`Client`)**: sessions and **interactive** transactions, using the node-postgres API. On Workers, "WebSocket connections can't outlive a single request", so connect, use and close inside one handler. | same |

What this means for us:
- The tick is an **interactive** transaction: lock the world row, read state, run `simulate()` in TypeScript, then write. **HTTP mode can't run it as written.** It would need data-model decision 3(b), a `commit_tick(diff jsonb)` plpgsql function, plus a separate read step that gives up the lock-then-read guarantee.
- WebSocket mode can run it, but through the **node-postgres** API. That means rewriting every postgres.js tagged template in `packages/server`.
- Hyperdrive or direct TCP with postgres.js keeps the code as it is.

---

## 3. Compute arithmetic for our cadence

### 3.1 What wakes Postgres today

- **The clock** (`apps/clock/src/index.ts`) POSTs the tick URL **every minute**, whether or not anyone is watching.
- **Every tick call opens a transaction against the DB** (`tick.ts` `tickWorld`): `select … for update nowait` on the world, then the `isWatched` query. Only after that does it decide that an unwatched world is inside its 5-minute cadence and return `idle`.
  - **So an idle call still counts as activity for scale to zero.** Data-model §3 step 2 says this outright: "The call still counts as activity."
  - `tickAllWorlds` does this for every world, so one Neon project's allowance covers all worlds. Watched time is the union across worlds.
- **Players** add traffic only while the app is open, which is a watched window anyway:
  - `mark_seen` every 60 s (`apps/web/src/live.ts`);
  - Meddle and Stable polling every 15 s (`Meddle.tsx`, `Stable.tsx`);
  - a 3 s × 12 Herald pickup poll (`Herald.tsx`);
  - refetches after each broadcast.
- **Narration drains and pushes** run in `waitUntil` right after a stepped tick (`http.ts`), and the Herald job runs on open. They land inside windows that are already awake. They add seconds, not wake-ups.
- **Each isolated visit costs about 10 minutes more than its length.** The world stays "watched" for 5 min after the last `mark_seen` (`CADENCE.watchedWindowMs`), and ticks once a minute through that time. The compute then needs another 5 min of quiet before it suspends.

### 3.2 Model

Assumptions:
- Awake CU-hours = 0.25 × [W + (730 − W) × f]. W is watched-awake hours per month, including the 10-minute tails. 730 is the average hours in a month.
- f is the fraction of unwatched time spent awake when unwatched worlds touch the DB every T minutes: f = min(1, (5 + 0.25)/T). That is the 5-minute suspend delay plus about 15 s for the wake, the tick and any drain.
- Compute is pinned at **0.25 CU** (UNCERTAIN on Free, see §1).
- The budget is 100 CU-h, which is 400 awake hours.

| Unwatched DB contact every… | f | Watched-awake 2 h/day | 4 h/day | 7 h/day | Most watched-awake time that fits |
|---|---|---|---|---|---|
| 1 min (today's clock: idle calls still query) | 1.00 | 183 | 183 | 183 | none |
| 5 min (today's sim cadence, if idle calls skipped the DB) | 1.00 | 183 | 183 | 183 | none |
| 10 min | 0.53 | 103 | 110 | 121 | ~1.2 h/day |
| **15 min** | 0.35 | 74 | 84 | 98 | ~7.3 h/day |
| **30 min** | 0.18 | 44 | 57 | 76 | ~10.9 h/day |
| 60 min | 0.09 | 30 | 44 | 65 | ~12.1 h/day |
| Catch-up tick on open only | 0 | 15 | 30 | 53 | ~13 h/day |

The middle columns are CU-hours per month, against the 100 CU-h budget.

What "watched-awake hours per day" looks like:
- 8 Players each opening the app 2× a day for 3 min, with no overlap, is 16 × 13 min ≈ **3.5 h/day**.
- 4 opens each is ≈ **6.9 h/day**.
- Short check-ins are dominated by the 10-minute tail, so overlapping visits (friends playing together) cost much less than this upper bound.

Reading the table:
- **Watched ticks at 1 min are affordable.** While someone watches, Postgres is awake anyway, and 1-minute ticks keep it awake no more than the Players' own `mark_seen` does.
- **The cost is entirely unwatched wake-ups.** 15 min fits typical play with some margin. 30 min leaves real room. 10 min or less doesn't fit.
- **The condition that makes any of this work:** the "is anyone watching / is a tick due?" decision must be made **without querying Postgres**. Otherwise the 1-minute clock alone keeps the compute awake. Where that decision lives (the clock, a Durable Object, presence on the Realtime channel) is a decision for the grilling tickets.
- **Catch-up on open** needs the least compute. It interacts with decision 15 (ambient rolls are not back-filled), so a world nobody opens would get fewer ambient events, not just later ones. That's a game-behaviour question for the grilling tickets, not settled here.
- **Shortening the watched window** (for example 5 → 2 min after the last `mark_seen`) would cut the 10-minute tail per visit. It's another lever, noted but not decided.

### 3.3 Storage and egress, rough estimates (UNCERTAIN, not measured)

There's no live database to measure, so these are order-of-magnitude figures. A throwaway measurement on a Neon branch would settle them.

**Storage (1 GB):**
- At the 5-minute unwatched cadence, `ticks` rows (~0.3 KB each) add about 8.6k rows a month per world, roughly 3 MB. Slower unwatched ticks shrink this.
- `facts`, `fact_causes`, `fact_blame`, `infamy_gains` and `clash_dialogue` are append-only and kept forever (decisions 1, 14). They are likely **tens of MB per world per year**.
- So 1 GB looks like years for a handful of worlds. At the cap, writes fail, so **the tick commit would fail** rather than the data being deleted.

**Egress (5 GB/month, the same suspend-on-cap rule):**
- Traffic from Neon to Cloudflare is public transfer.
- One stepped tick's state load (≤ 870 affinity rows, recent tags, causes, the 7-day Infamy window, the 24 h recency aggregates) is plausibly 30–100 KB. At 15-minute unwatched ticks that's about 0.3 GB a month per world.
- Player polling (8 Players, a 15 s poll while open) plausibly adds **0.5–1 GB** a month.
- That's likely under 5 GB, but it's the second hard cap and should be measured.

---

## 4. Extensions and Postgres features the migrations use

From a sweep of the 21 files in `supabase/migrations/`:
- `security definer` appears 24 times, `create policy` 27, `enable row level security` 30, `to authenticated` 59;
- there are 10 triggers, 7 views (`security_invoker` true or false) and one GIN index;
- `gen_random_uuid()` appears 5 times, `extensions.gen_random_bytes` once;
- `auth.uid()` appears 6 times, `auth.users` once, `realtime.*` 5 times;
- there is **no** `pg_cron`, `pg_net`, `pgsodium` or `vault`.

The local stack runs Postgres 17 (`supabase/config.toml`).

| Feature | On Neon? | Source / note |
|---|---|---|
| Postgres 17 | Yes. The extension table covers PG14–18. | [Extensions](https://neon.com/docs/extensions/pg-extensions) (2026-11-04) |
| `gen_random_uuid()` | Yes. It's core Postgres since 13 and needs no extension. | — |
| `pgcrypto` (`gen_random_bytes`) | **Yes**: 1.3 on PG16/17, 1.4 on PG18. But `extensions.gen_random_bytes(16)` in `20261030002500_invites_and_joining.sql` relies on Supabase's `extensions` schema. On Neon, either `create extension pgcrypto` (it installs into `public`) and drop the prefix, or create an `extensions` schema and install it there. | [Extensions](https://neon.com/docs/extensions/pg-extensions) |
| `pg_cron` | Available (1.6), but "runs only while the compute is active, so it needs scale to zero disabled". It can't be disabled on Free, so **pg_cron is not a usable clock on Free**. We don't use it. Neon points to scheduled Function Triggers instead (§5). | [Extensions](https://neon.com/docs/extensions/pg-extensions) |
| `pg_net` | **Not listed** as supported. We don't use it. | [Extensions](https://neon.com/docs/extensions/pg-extensions) |
| RLS, policies, plpgsql triggers, views with `security_invoker`, GIN on `text[]` | Yes. All of it is core Postgres. | — |
| `CREATE ROLE`, grants and revokes | Yes, with SQL `CREATE ROLE`. The default `neon_superuser` group has `CREATEROLE`, `CREATEDB` and `BYPASSRLS`, but **not `SUPERUSER`**. SQL-created roles get only basic `public` privileges and aren't added to `neon_superuser`. | [Manage roles](https://neon.com/docs/manage/roles) (2026-11-05) |
| `security definer` functions | Not mentioned in Neon's docs, and it's plain Postgres. Our definer functions bypass RLS because the **table owner** owns them. The migrations never `force row level security`. So it works as long as the migration role owns both tables and functions. Note that `BYPASSRLS` is a role attribute, and Postgres doesn't inherit it through `neon_superuser` membership. | inference |
| `anon`, `authenticated`, `service_role` roles | **Don't exist on Neon** by default. The migrations `revoke … from anon` and `service_role`, and `grant … to authenticated, service_role`, so these statements fail until the roles exist. Neon's Data API uses `authenticated` and **`anonymous`** (not `anon`). | [Data API](https://neon.com/docs/data-api/get-started) (2026-10-09) |
| `auth.uid()`, `auth.users` (FK on `players.user_id`) | Supabase-only. Neon's Data API documents `auth.user_id()` (the JWT `sub` as text) and `auth.uid()` (as uuid, NULL if `sub` isn't a UUID). That's close to Supabase's. `auth.users` doesn't exist. | [Data API](https://neon.com/docs/data-api/get-started) |
| `realtime.send`, `realtime.messages`, `realtime.topic()` | Supabase-only. They don't exist on Neon. `broadcast()` in `packages/server/src/realtime.ts` and the policy in `20261030003100_live_watching.sql` need replacing. | — |

---

## 5. Things on Neon's Free plan that other tickets may want (facts only)

The pricing page lists more than Postgres on Free. Each item needs its own check by the ticket that owns that role:

| Offer on Free (per project) | Source (last updated) |
|---|---|
| **Auth** (Managed Better Auth, marked beta): up to 60,000 MAU. A first-party search result says magic links and OTP are among its methods. That wasn't verified on a docs page, and the email provider is unknown. | [Plans](https://neon.com/docs/introduction/plans), [Pricing](https://neon.com/pricing) |
| **Data API**: REST over Postgres with JWT auth, `authenticated`/`anonymous` roles, RLS and `auth.uid()`. Its client is `@neon/postgrest-js` with a `.from().select().eq()` style. Free availability and CU-hour accounting aren't stated on its page. | [Data API](https://neon.com/docs/data-api/get-started) |
| **Realtime** ("live queries", Live SQL API), free during beta. Neon doesn't charge for the service, but **starting a live query can wake the compute**, which counts toward CU-hours, and data sent counts as egress. | [Plans](https://neon.com/docs/introduction/plans), [Pricing](https://neon.com/pricing) |
| **Functions**: Node.js, deployed per branch in the DB's region, in 4 AWS regions. 10 active plus 400 waiting Capacity-Hours and 1M invocations a month. HTTP or **cron Function Triggers** (UTC; minimum interval not stated). Triggers fire while the compute is at zero, but any DB query in the handler wakes it. | [Functions](https://neon.com/docs/functions) (2026-11-02), [Triggers](https://neon.com/docs/compute/functions/triggers/overview) (2026-10-20), [Plans](https://neon.com/docs/introduction/plans) |
| **Object Storage**: 5 GB, sharing the 5 GB egress. | [Pricing](https://neon.com/pricing) |

Any of these that touches Postgres spends the same 100 CU-hours and 5 GB egress. A suspended compute takes all of them down together.

---

## 6. Risks to carry into the grilling tickets

1. **Hard monthly cliff.** At 100 CU-h or 5 GB egress the compute is suspended until next month. The game stops; it doesn't slow down. Free has no spending notifications and keeps only 1 day of monitoring, so we'd have to track usage ourselves.
2. **Idle calls must not query Postgres.** Under today's clock and tick code, Neon fails at 183 CU-h regardless of the unwatched cadence constant.
3. **Autoscaling above 0.25 CU** multiplies burn (2 CU burns 8× faster). The Free default range and whether it can be pinned are UNCERTAIN.
4. **Unknown wake sources.** Docs don't say whether Hyperdrive pool health checks, pooler connections or console and monitoring queries reset the 5-minute timer. Measure it on a throwaway project: a minute of known traffic, then watch the compute state.
5. **Cold starts of a few hundred ms** on the first unwatched tick after suspension, and on a Player's first open. postgres.js's `connect_timeout: 10` covers it.
6. **The serverless driver's HTTP mode can't run the tick transaction.** Staying on postgres.js means TCP from Workers (Hyperdrive or direct).
7. **pg_cron can't be the clock on Free**, because scale to zero can't be disabled.
