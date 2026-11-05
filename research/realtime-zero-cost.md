# Realtime broadcast at $0 without Supabase

Ticket: [#51 Realtime broadcast at $0 without Supabase](https://github.com/abdullah12353/orc-simulator/issues/51) (map [#47](https://github.com/abdullah12353/orc-simulator/issues/47)). Feeds the grilling ticket [#55 Realtime replacement](https://github.com/abdullah12353/orc-simulator/issues/55).
Researched: 2026-11-05. Repo facts are from `main` at `d23ba1e`.
Facts only. The choices belong to #55. Anything the sources don't settle is marked **UNCERTAIN**.

---

## 1. What we're replacing (repo facts)

| Fact | Where |
|---|---|
| One private channel per world, `world:<id>`. Two events, both pointers, never data: `tick {tick_seq}` and `dialogue {fact_no}`. | `packages/server/src/realtime.ts` |
| Sent with `select realtime.send(payload, event, topic, true)`. That writes a row to `realtime.messages`, so it is **transactional**: it goes out only if the surrounding transaction commits. `realtime.send` never throws, so a Realtime problem can't fail the tick. | `packages/server/src/realtime.ts` |
| `tick` is sent as the **last statement inside the tick transaction**, only if the world is watched and the tick made Facts (`watched && facts.length > 0`). | `packages/server/src/tick.ts:200` |
| `dialogue` is sent inside the small transaction that upgrades `clash_dialogue` from fallback to generated, only if exactly one row was upgraded and the world is watched. It runs in the background after the tick answers (`waitUntil`). | `packages/server/src/narration/drain.ts:185`, `packages/server/src/http.ts` |
| Membership check: RLS on `realtime.messages` for `authenticated`, via `can_hear_world(realtime.topic())`, which validates the `world:<uuid>` shape and calls `is_world_member`. No insert policy: clients never send on the channel. | `supabase/migrations/20261030003100_live_watching.sql` |
| The spec (data-model §3 step 7) says the broadcast is "after commit, out of band". The code instead sends it inside the transaction via `realtime.send`, which gives the same after-commit guarantee. | `.scratch/orc-nonsense/data-model.md` §3, `realtime.ts` |
| Client: one shared channel per world (`supabase.channel('world:<id>', { private: true })`). On `SUBSCRIBED` (first join and every reconnect) it fires every listener with `null`, meaning "you may have missed something, refetch". | `apps/web/src/live.ts` |
| Listeners: `App.tsx` (fact lines), `world-load.ts` (every `useWorldLoad` screen reloads on a nudge), `LiveStage.tsx` (fetches Facts with `tick_seq > cursor` and queues them; `live-queue.ts` turns them into Clash cards, Introductions and notices). `useDialogue` refetches one `clash_dialogue` row. | `apps/web/src/*.tsx`, `apps/web/src/live-queue.ts` |
| The client **already polls**: `useSeen` calls the `mark_seen` RPC on open, every 60 s while visible, and on visibility change. `Meddle.tsx` and `Stable.tsx` also reload their data every **15 s** (`POLL_MS = 15_000`). | `apps/web/src/live.ts`, `Meddle.tsx:19`, `Stable.tsx:15` |
| The clock is already a Cloudflare Worker with a 1-minute cron (`crons = ["* * * * *"]`) that POSTs to the tick endpoint. | `apps/clock/wrangler.toml` |
| Watched = any Player seen in the last 5 min. Watched worlds step every minute, unwatched every 5 min (the map allows slowing unwatched to 15–30 min). | `packages/server/src/tick.ts` (`CADENCE`, `isWatched`) |

What a replacement must keep:
1. **After commit only.** A nudge must never point at a tick that rolled back.
2. **Members only.** Only Players of the world receive it.
3. **Best effort.** Losing a nudge is fine: the client refetches on reconnect, and the tick must not fail because the broadcast did.
4. **Pointer only.** The payload is a number. Data is always refetched.

---

## 2. Verdict (facts, not the decision)

**A Durable Object per world, using the WebSocket Hibernation API, fits the Workers Free plan with lots of headroom, needs no card, and keeps all three guarantees.** Each one needs a deliberate design choice, though:
- after commit: the sender calls the DO after the transaction resolves;
- members only: the Worker checks membership before it forwards the upgrade;
- best effort: refetch on reconnect, as today.

The real budget risk is **duration**, not requests. A DO that never hibernates burns about 83% of the free daily duration on its own (see §5).

Polling is also viable at $0, and the app already half-does it. Its cost depends on what the poll endpoint reads: if it touches Neon, it keeps Neon compute awake. That matters more than the Worker request count.

---

## 3. Durable Objects on the Workers Free plan (Cloudflare primary sources)

Freshness: I fetched every page below on 2026-11-05, and the "last updated" date shown is the page's own.

| Fact | Source (last updated) |
|---|---|
| DOs are on the Free plan, **SQLite storage backend only**. The changelog says they have been since 2025-04-07. | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) (2026-10-18), [Changelog 2025-04-07](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/) |
| Free daily allowances: **100,000 requests/day**, **13,000 GB-s duration/day**, **5 million SQLite rows read/day**, **100,000 rows written/day**, **5 GB stored (total)**. | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) (2026-10-18) |
| Over a free limit: "further operations of that type will fail with an error." Daily limits reset at **00:00 UTC**. Nothing gets billed. | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) (2026-10-18) |
| Free-plan users are not charged for SQLite storage (storage billing started January 2026 for Paid). | [Changelog: Billing for SQLite Storage](https://developers.cloudflare.com/changelog/post/2025-12-12-durable-objects-sqlite-storage-billing/) |
| What counts as a request: HTTP requests, RPC sessions ("Each RPC session is billed as one request"), WebSocket messages, and alarm invocations. | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| WebSocket billing: opening a connection is 1 request. **Incoming messages are billed 20:1** (100 messages = 5 requests). "There is no charge for outgoing WebSocket messages, nor for incoming WebSocket protocol pings." Application-level auto-responses through `setWebSocketAutoResponse()` "will not incur additional wall-clock time, and so they will not be charged." | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Duration billing: "charges for the 128 MB of memory your Durable Object is allocated, regardless of actual usage". So 1 s awake = **0.125 GB-s**. Objects that are "idle and eligible for hibernation are not billed for duration". | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Limits: 100 DO classes per account on Free. SQLite storage is 5 GB per account on Free. Per-object storage is 10 GB in the table, but the FAQ says "1 GB on the Free plan". **UNCERTAIN which applies**, and irrelevant at our size, since the DO only needs to store a tick number. | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) (2026-10-29) |
| CPU per request (SQLite DOs): **30 s by default, configurable up to 5 min**. The table shows no Free/Paid split, but the FAQ says DOs "have the same per invocation CPU limits as any Workers do". **UNCERTAIN** whether a Free-plan DO really gets 30 s. Each incoming request or WebSocket message resets the timer. | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) (2026-10-29) |
| Soft limit of 1,000 requests/s per object. Received WebSocket messages up to 32 MiB. | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| Up to **32,768 WebSocket connections per DO**. Up to 10 tags per socket, 256 chars each. `getWebSockets(tag)` filters by tag. Auto-response request and response are each up to 2,048 chars. | [DO State API](https://developers.cloudflare.com/durable-objects/api/state/) (2026-09-30) |
| Alarms: one alarm per object at a time. On SQLite DOs, "Each `setAlarm()` is billed as a single row written", and alarm invocations count as requests. The alarms page doesn't mention plan gating; the pricing page bills them on the SQLite backend, which is the only one Free has. | [Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/) (2026-04-21), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |

### 3.1 Hibernation

| Fact | Source (last updated) |
|---|---|
| The Hibernation API "Allows the Durable Object to hibernate without disconnecting clients when idle". Use `ctx.acceptWebSocket(ws, tags)`, not `ws.accept()`. Duration charges "do not accrue during hibernation." | [Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) (2026-10-30) |
| A DO becomes hibernation-eligible "after 10 seconds of inactivity". Each of these blocks hibernation: a pending `setTimeout`/`setInterval`, unfinished I/O or a `waitUntil` promise, open **outbound** connections, a socket on the standard (non-hibernation) API, or a request still in progress. A non-hibernatable idle DO is evicted after 70–140 s. | [DO lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) (2026-10-30) |
| Billing by state: duration is billed only while the DO is active in memory, or idle but **not** hibernatable. | [DO lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) |
| "Ping/pong handling does not interrupt hibernation", and auto-responses "keep connections alive without waking the Durable Object". `webSocketMessage` isn't called for control frames. | [Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| "In-memory state is reset" on hibernation, and the constructor runs again on the next event. Per-connection state survives in `serializeAttachment()`, up to **16,384 bytes** per socket. | [Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| An open **outbound** WebSocket doesn't hibernate and can keep the object in memory for up to 15 min. A `waitUntil` promise prevents eviction for up to 15 min. So a DO that holds a Postgres connection (for example a `LISTEN` session) would never hibernate. | [Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [DO State API](https://developers.cloudflare.com/durable-objects/api/state/) |

### 3.2 Workers Free plan (the front door to the DO)

| Fact | Source (last updated) |
|---|---|
| **100,000 requests/day**, resetting at midnight UTC. Going over returns Error 1027 (fail closed), or skips the Worker (fail open). | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (2026-10-29) |
| 10 ms CPU per HTTP request and per Cron Trigger. 50 subrequests per invocation (1,000 to internal services). 6 simultaneous outgoing connections. 128 MB memory. **5 Cron Triggers per account.** | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| "WebSocket connections made to a Worker are charged as a request". That covers the upgrade only. Messages relayed through the Worker are not counted as requests. | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) (2026-10-02) |
| A Worker calling a DO through a binding: the DO side bills it as a DO request (one per RPC session). Workers pricing doesn't say whether the call also costs a Worker subrequest. **UNCERTAIN**, but only the 50-subrequest cap is involved, not the daily total. | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| No hard limit on WebSocket duration while the client stays connected. During runtime updates, connections get a grace period of up to 20 min, so **clients must expect server-side disconnects**. | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |

---

## 4. The three requirements on a DO

### 4.1 Members only: authenticating the WebSocket

| Fact | Source (last updated) |
|---|---|
| "Browsers cannot set an `Authorization` header on a WebSocket upgrade." For WebSocket clients, "read a token from a cookie or a query parameter". | [Agents: Authentication](https://developers.cloudflare.com/agents/runtime/routing/authentication/) (2026-10-29) |
| Check the caller in the Worker "before the request reaches the Durable Object. The object then only sees requests you have already allowed." The DO docs also say: "Validate requests in your Worker to avoid billing for invalid requests against a Durable Object." | [Agents: Authentication](https://developers.cloudflare.com/agents/runtime/routing/authentication/), [Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| The usual shape: a Worker handles auth and routing, then calls `env.WORLD.idFromName(worldId)` and `stub.fetch(request)` to forward the upgrade. The DO calls `acceptWebSocket`. | [Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) |
| Cloudflare's docs don't mention `Sec-WebSocket-Protocol` as a way to carry a token. **UNCERTAIN / undocumented** here. | (none of the pages above) |

What #55 will need to settle (it depends on #52, Auth and Player identity):
- **What credential.** A session cookie or a short-lived token in the query string. Query strings can end up in logs. A cookie only reaches the Worker if the Worker is served same-site with the Pages app.
- **How the Worker checks membership.** Today that's `is_world_member(world_id)` under `auth.uid()`. Either the Worker runs one Neon query per connect, or a signed token carries the world memberships, so no Neon query is needed.
- **Removal.** Today RLS is evaluated on join. A DO keeps a socket open until someone closes it. A removed Player stays connected until a disconnect, unless the DO is told to close sockets tagged with that Player (tags and `getWebSockets(tag)` support this). Low stakes, since the nudge is only a number and all data is refetched under the data-access rules.

### 4.2 After commit only: notifying the DO

Facts that bound the options:
- Today `realtime.send` is a row write inside the transaction (an outbox that Supabase drains). Nothing in Neon or Cloudflare drains a Postgres row by itself. Neon has no equivalent of `realtime.send`.
- **After-commit call.** `await sql.begin(...)` resolves only after `COMMIT`, then the Worker makes one DO call (`stub.fetch` or RPC). That costs 1 DO request and 1 subrequest. It never fires for a rolled-back tick. It can be lost if the Worker dies between commit and call, or if the DO call fails. Cost of a loss: watchers miss one nudge, but they refetch on the next nudge, on reconnect, and (on the Meddle/Stable screens) on the 15 s poll.
- **Outbox row.** For example, a `world_nudges` row written in the transaction and drained after commit. This survives a crash, but it adds a Neon write per tick and needs a drainer. Today `push_jobs` and `narration_jobs` already work this way, drained in `waitUntil` after the tick answers (`packages/server/src/http.ts`).
- **The DO as the source of truth for "latest tick".** If the after-commit call carries `tick_seq`, the DO can keep it in SQLite (1 row written per call, well within 100,000/day). It can then send that value to every client on (re)connect, so a client doesn't need a Neon read to learn whether it's behind.

### 4.3 Best effort

- `realtime.send` never throws today. A DO call should be wrapped the same way (catch and log) so a DO error can't fail a tick that already committed. Because the call comes after commit, it can't roll anything back anyway.
- The client's "`SUBSCRIBED` means refetch" behaviour maps directly onto the WebSocket `open` event, and needs reconnect with backoff, since the server can drop sockets (runtime updates, §3.2).

---

## 5. Budgets at our size

Assumptions: up to **5 worlds × 8 Players**. Worst case, every world is watched 24 h. A watched world ticks 1,440 times/day and, at worst, every tick is productive, so 1,440 `tick` nudges/day/world, plus a few dozen `dialogue` nudges. Mobile PWAs reconnect often, so assume **50 connects per Player per day**.

### 5.1 DO plus hibernation (requests)

| Item | Per world/day | 5 worlds/day | Free limit |
|---|---|---|---|
| Nudges from the tick and drain (1 DO request each) | ~1,500 | ~7,500 | 100,000 DO requests |
| WebSocket connects (1 Worker request + 1 DO request each) | 400 | 2,000 | 100,000 each |
| Client keep-alive: protocol pings or `setWebSocketAutoResponse` | 0 (not charged) | 0 | — |
| Same keep-alive, if sent as normal app messages every 30 s (20:1) | 8 × 2,880 / 20 ≈ 1,150 | ~5,800 | 100,000 DO requests |
| **Total DO requests** | **~2,000–3,000** | **~10,000–15,000 (10–15%)** | 100,000 |

### 5.2 DO duration: the real risk

| Scenario | GB-s/day per world | Share of the 13,000 GB-s/day |
|---|---|---|
| Hibernating properly: wakes for ~0.1–1 s per nudge, 1,500 wakes | 19–190 | 0.15–1.5% |
| Pessimistic: 10 s awake per wake (the idle window before hibernation) | 1,500 × 10 s × 0.125 = 1,875 | 14% (72% for 5 worlds) |
| **Never hibernates** (for example a timer, an outbound connection, or `ws.accept()`): 86,400 s × 0.125 | **10,800** | **83%. Two such worlds exceed the free limit.** |

When duration runs out, DO operations "fail with an error" until 00:00 UTC. Nudges stop, but the game keeps working, because data is refetched and screens poll.

### 5.3 Polling as the baseline

Polling costs 1 Worker request per poll, per open client. Figures are per Player-hour of open, visible app:

| Interval | Requests per Player-hour | 8 Players × 2 h/day | 8 Players × 24 h (worst case) |
|---|---|---|---|
| 10 s | 360 | 5,760 | 69,120 |
| 15 s | 240 | 3,840 | 46,080 |
| 30 s | 120 | 1,920 | 23,040 |

- Worker requests: realistic use (a couple of hours a day) is 2–6% of 100,000/day per world. The worst case (everyone open all day at 10–15 s) reaches 46–69% for **one** world, so several busy worlds could hit Error 1027. That cap is shared with every other Worker route (tick, functions, data API calls).
- **Neon compute is the cost that matters, and it depends on what the endpoint reads.** Neon Free: 100 CU-hours/project/month, minimum compute 0.25 CU (1 GB RAM), scale-to-zero "After 5 min" and "cannot be turned off" on Free, no credit card. When the allowance runs out, "your compute is suspended until the next billing period". At 0.25 CU, 100 CU-hours is **400 awake hours/month, about 12.9 h/day**. ([Neon plans](https://neon.com/docs/introduction/plans), 2026-11-04; [Neon pricing](https://neon.com/pricing), 2026-10-31; [Neon computes](https://neon.com/docs/manage/computes), 2026-11-05)
  - While a world is watched, Neon is **already awake**: the tick runs every minute, `mark_seen` runs every 60 s per client, and Meddle/Stable poll every 15 s. So a poll that reads Neon costs about 0 extra CU-hours then.
  - A poll that reads Neon after the last watcher leaves, or from a background tab, keeps the 5-min suspend timer from ever firing. Neon's docs: "Each connection resets the scale to zero timer." ([Neon pooling docs](https://neon.com/docs/connect/connection-pooling), 2026-10-19; [Neon computes](https://neon.com/docs/manage/computes))
  - A poll that reads only a cheap non-Neon value (for example the DO's stored `tick_seq`) costs no Neon compute. It does cost 1 Worker request plus 1 DO request per poll, so it doubles the request count above.
- The data a nudge triggers (the refetch) costs the same under polling and under a DO. The only difference is how often an unchanged world gets refetched. Under polling, a cheap "what's the latest `tick_seq`?" check avoids refetching unchanged data.

---

## 6. Other $0 options, in passing

| Option | Fact | Source (last updated) |
|---|---|---|
| Postgres `LISTEN/NOTIFY` on Neon | Not supported through the pooler (PgBouncer transaction mode). It needs a direct, long-lived connection. Scale-to-zero "will terminate all listeners", and on Free scale-to-zero can't be turned off. A listener would also keep Neon awake (no suspend), and a DO holding that connection would never hibernate (§3.1). Unlikely to fit. | [Neon pooling](https://neon.com/docs/connect/connection-pooling) (2026-10-19), [Neon LISTEN/NOTIFY guide](https://neon.com/guides/pub-sub-listen-notify), [Neon plans](https://neon.com/docs/introduction/plans) |
| Cloudflare Agents SDK | A framework on top of DOs, with `onBeforeConnect` auth hooks and a `query` option on the client for tokens. It's an option for the DO wrapper, not a separate service. | [Agents: Authentication](https://developers.cloudflare.com/agents/runtime/routing/authentication/) (2026-10-29) |
| Server-Sent Events from a DO | Not researched. The browser `EventSource` can't set headers either, so it has the same auth shape as WebSockets. It would hold an open HTTP request, so the DO couldn't hibernate. **UNCERTAIN, not verified.** | none |

---

## 7. What the grilling ticket (#55) will need to decide

1. **DO, polling, or both.** For example, a DO for live nudges, with polling as the fallback when the WebSocket is down or DO quota has run out.
2. **After-commit call or outbox row** for notifying the DO.
3. **Socket auth:** cookie or query token, and how membership is checked at connect time (a Neon query, or claims in the token). This depends on #52.
4. **What happens on Player removal**, given that a DO doesn't re-check membership after the join.
5. **Where the DO lives:** in the tick Worker's script, or its own Worker with a binding. This touches #50 and #54 (tick host).
6. **Hibernation discipline as a rule** (no timers, no outbound connections, `acceptWebSocket` only), because breaking it is what turns the DO from about 1% of the duration budget into 83% per world.
7. **Spec amendment:** data-model §3 step 7 says "after commit, out of band", but the code sends the broadcast inside the transaction. The new design has to say which one is meant.

## Sources not settled

- Whether a Free-plan DO gets the 30 s CPU from the limits table, or Workers' 10 ms (§3). This matters to #50/#54 if anyone considers running the tick inside a DO.
- Per-object SQLite cap on Free: 1 GB (FAQ) vs 10 GB (table).
- Whether a Worker-to-DO call also counts as a Worker subrequest.
