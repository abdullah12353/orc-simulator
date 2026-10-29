# Free-tier platform limits (Supabase, Cloudflare, Web Push)

Ticket: "Free-tier platform limits"
Researched: 2026-10-29. Every source below was accessed on **2026-10-29**.
Sources are official docs, pricing pages, specs, or the library's own repository. Anything the sources don't settle is marked **UNCERTAIN**.

Context: ORC NONSENSE, a private game for a handful of friends. The world ticks about every 1 min while someone has the app open and about every 5 min otherwise. Stack: React + TS PWA on Cloudflare Pages/Workers, Supabase Free for Postgres, Realtime and Auth. Goal: near-zero cost.

Worst-case tick volume used in the budgets below: 1 tick/min for 24 h, which is **1,440/day and about 44,640/month** (31 days).

---

## 1. Supabase Free plan

### 1.1 Project pausing

| Fact | Source |
|---|---|
| "Free projects are paused after 1 week of inactivity." Limit of 2 active projects. Paused projects do not count toward that limit. | [Pricing](https://supabase.com/pricing), [Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq) |
| "A Free plan project is considered inactive if it does not receive sufficient user database activity over the past week." A few user requests per day is usually enough. Low but non-zero usage can still lead to a pause. | [Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing) |
| Activity that counts: visiting the project in the Dashboard, or making API calls / requests from a connected application. The KB says: "Opening the project in the dashboard or sending real requests from your app both count as activity", and adds that a few requests a day "isn't a guarantee". | [Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [KB: Do Supabase projects pause?](https://supabase.com/kb/faqs/platform/free-project-pausing) |
| Warning email about 1 week before the pause, then a confirmation email once paused. Generating activity after the warning prevents the pause. | [Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing) |
| A paused project can be restored from Studio within a **1-year** window. Data and settings are kept. After the window, you download the backup. The project moves to the latest minor Postgres version on restore. | [Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [Upgrading](https://supabase.com/docs/guides/platform/upgrading) |
| Paid plans are never paused for inactivity. | [KB](https://supabase.com/kb/faqs/platform/free-project-pausing), [Production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) |

**Does a scheduled write or API call count as activity?**
- **External API call (PostgREST/RPC from a Cloudflare Worker): very likely yes.** The docs list "making API calls" and "real requests from your app" as activity. A Worker calling the REST API looks the same as app traffic. UNCERTAIN only because Supabase never defines "sufficient", and the KB says a few requests a day "isn't a guarantee".
- **In-database pg_cron job: UNCERTAIN, so don't rely on it.** No official page says whether pg_cron or other internal jobs count as "user database activity". The only claims either way come from community posts, which are not primary sources and contradict each other. Also, if the project pauses anyway, pg_cron stops with it, so a pg_cron keep-alive can't recover on its own.
- The 1-year restore window conflicts with a "90 Days Remaining" screenshot caption on the Upgrading page. The written text says 1 year. **UNCERTAIN** on the exact window, but it doesn't matter if we never pause.

### 1.2 Database size and compute

| Fact | Source |
|---|---|
| 500 MB database size included per project. 1 GB file storage, 5 GB egress plus 5 GB cached egress, 50 MB max upload. | [Pricing](https://supabase.com/pricing) |
| Going over 500 MB does **not** trigger read-only mode. It is a billing quota, measured per organization as the **average daily** size over the billing cycle. Going over can mean `402` responses under the Fair Use policy until you upgrade or the cycle resets. Read-only mode happens when **disk** usage hits 95% of the Free plan's fixed 2 GB disk. Disk includes WAL. | [Database size](https://supabase.com/docs/guides/platform/database-size) |
| Free compute is **Nano**: shared CPU, up to 0.5 GB RAM, 60 direct DB connections, 200 pooler clients. "Compute resources on the Free plan are subject to change." | [Compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk) |
| No automatic backups or PITR on Free. Log retention is 1 day. | [Pricing](https://supabase.com/pricing) |

Implication: an append-only event log of orc nonsense must be pruned or summarised. Size is judged on the monthly average, so a spike is forgiven slowly, not right away.

### 1.3 Realtime

| Fact | Source |
|---|---|
| Free: **200 concurrent peak connections** and **2 million messages/month**. No overage rate on Free. | [Pricing](https://supabase.com/pricing), [Realtime pricing](https://supabase.com/docs/guides/realtime/pricing) |
| Per-second limits on Free: 100 messages/s, 100 channel joins/s, 100 channels per connection. Presence: 10 keys per object, 20 messages/s, 5 calls per client per 30 s. Broadcast payload up to 256 KB. Postgres Changes payload up to 1,024 KB; above that, only fields of 64 bytes or less are sent. | [Realtime limits](https://supabase.com/docs/guides/realtime/limits) |
| Message counting: "Each database change counts as one message per client that listens to the event." Each broadcast counts as 1 message sent plus 1 per subscribed receiver. Server-side subscribers count as receivers, so use the Broadcast REST API to send from the server. | [Manage Realtime Messages usage](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages) |
| Going over the quota: an email notification, then a grace period under the Fair Use Policy. | same |

Budget: 2M/month is about **64,500/day, or about 45/min**.
- 1 broadcast per tick to 5 listeners is (1+5) x 1,440 = 8,640/day, about **268k/month (13%)**. Fine.
- Postgres Changes on per-orc rows is risky. For example, 30 rows changed per tick x 5 listeners is 150/tick, about **6.7M/month at full tick rate**. That is well over the quota.
- Recommendation: send **one small broadcast per tick** (for example `{tick: n}`), and have clients refetch through PostgREST. Note that refetching uses the 5 GB egress quota.

### 1.4 Edge Functions

| Fact | Source |
|---|---|
| Free: **500,000 invocations** included. No overage rate on Free. | [Pricing](https://supabase.com/pricing), [Functions pricing](https://supabase.com/docs/guides/functions/pricing) |
| Limits: **2 s CPU per request** (async I/O not counted), 256 MB memory, **150 s wall clock** on Free (400 s paid), 150 s request idle timeout (then 504), 100 functions per project on Free. | [Functions limits](https://supabase.com/docs/guides/functions/limits) |

Budget: one invocation per tick is about 44,640/month, **about 9% of quota**.

### 1.5 pg_cron / Supabase Cron

| Fact | Source |
|---|---|
| Jobs can run "anywhere from every second to once a year". Sub-minute schedules use `[1-59] seconds` and need Postgres 15.1.1.61 or later. Recommended: no more than 8 concurrent jobs, each running no more than 10 minutes. Can call Edge Functions through `net.http_post`, which needs the `pg_net` extension. | [Cron](https://supabase.com/docs/guides/cron), [Cron quickstart](https://supabase.com/docs/guides/cron/quickstart) |
| Supabase Cron status is **Beta**. | [Features](https://supabase.com/docs/guides/getting-started/features) |
| **Free-plan availability: UNCERTAIN, though likely available.** The pricing, cron, pg_cron extension, and features pages show no plan gating, but none of them say outright that it's available on Free. | [Cron](https://supabase.com/docs/guides/cron), [pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron) |

### 1.6 Auth

| Fact | Source |
|---|---|
| 50,000 MAU (and 50,000 third-party MAU) on Free. Auth audit logs kept for 1 hour. Phone MFA and SSO not included. | [Pricing](https://supabase.com/pricing) |
| Built-in email provider: **2 emails/hour** across all email-sending endpoints. Use custom SMTP or the Send Email hook to raise it. | [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits) |
| Other defaults: sign-up/sign-in/recover/magiclink/otp/user at 30 requests per 5 min per IP. OTP/magic link at 1 per user per 60 s. `/token` (including refresh) at 150 requests per 5 min per IP. Anonymous sign-ins at 30/hour per IP. MFA at 15/min per IP. SMS at 30/hour. A 429 is returned when a limit is exceeded. Most of these are configurable. | same |

Implication: with the built-in email provider, magic-link login allows only 2 emails/hour for the whole project. For a handful of friends, use OAuth (for example Discord or Google), long-lived sessions, or a free custom SMTP.

---

## 2. Cloudflare Free plan

### 2.1 Workers and Cron Triggers

| Fact | Source |
|---|---|
| **100,000 requests/day**, resetting at 00:00 UTC. When exceeded: Error 1027. The route then either fails open (Worker bypassed) or fails closed (error page). | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| **CPU time: 10 ms per HTTP request and 10 ms per Cron Trigger** on Free. Paid allows 30 s for intervals under 1 hour, and 15 min for intervals of 1 hour or more. Waiting on `fetch()`, KV, or DB queries does **not** count toward CPU time. Going over gives Error 1102 (`exceededCpu`). Free can't raise the limit. | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Scheduled Workers: maximum 15 min **wall** time. Memory 128 MB. **50 subrequests** per invocation. 6 simultaneous open connections. 100 Workers per account. 64 MiB Worker size. 64 env vars of 5 KB each. | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| **5 Cron Triggers per account** on Free. | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Cron syntax: 5 fields plus Quartz extensions, in UTC. Changes take up to 15 min to propagate. Scheduled Workers "run on underutilized machines", and no exact timing is promised. | [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) |
| **Minimum interval: UNCERTAIN.** It is never stated outright. The shortest example is `* * * * *` (every minute), and the 5-field syntax has no seconds field, so in practice the minimum is **1 minute**. | [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) |
| **UNCERTAIN:** whether cron invocations count toward the 100k/day request quota. Either way, 1,440/day is about 1.4%. | — |

### 2.2 Durable Objects, D1, KV, R2, Queues on Free

| Product | Free plan | Source |
|---|---|---|
| **Durable Objects** | Available, **SQLite-backed only**. 100k requests/day. 13,000 GB-s duration/day. 5M rows read/day. 100k rows written/day. 5 GB total storage per account. Per object: 1 GB on Free (the FAQ says 1 GB, the general table says 10 GB). 30 s CPU per request/message by default. Alarm handler wall time up to 15 min. Incoming WebSocket messages bill at **20:1** toward requests, outgoing are free. Hibernating or idle objects are not billed for duration. Going over a limit makes that operation fail with an error. | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| **D1** | 5M rows read/day. 100k rows written/day. 5 GB total storage. 10 databases. **500 MB max per database**. 50 queries per Worker invocation. | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| **KV** | 100k reads/day. **1,000 writes/day**. 1,000 deletes/day. 1,000 lists/day. 1 GB storage. 1 write/s to the same key. 25 MiB values. | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/) |
| **R2** | 10 GB-month storage. 1M Class A ops/month. 10M Class B ops/month. Free egress. Standard storage class only. **UNCERTAIN:** whether enabling R2 needs a payment method on file. The pricing page doesn't say. | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Queues / Workflows / Logs | Queues: 10k ops/day. Workflows: 3,000 steps/day, sharing the Workers request quota. Workers Logs: 200k events/day, 3-day retention. | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |

Notes:
- KV at 1,000 writes/day can't take a write every minute (1,440/day). **Don't put per-tick state in KV.**
- D1 at 100k rows written/day is about 69 rows per tick at the full 1-minute rate.

### 2.3 Pages

| Fact | Source |
|---|---|
| 500 builds/month, 1 concurrent build, 20 min build timeout. 20,000 files per site. 25 MiB per asset. 100 custom domains per project. 100 projects per account. | [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) |
| "On both free and paid plans, requests to static assets are free and unlimited." Pages Functions requests count toward the Workers Free quota (100k/day). | [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Workers static assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) |

---

## 3. PWA Web Push

### 3.1 Platform support

| Platform | Support | Source |
|---|---|---|
| **iOS / iPadOS Safari** | **iOS/iPadOS 16.4 or later, Home Screen web apps only.** The web app must be added to the Home Screen. The manifest needs `display: standalone` or `fullscreen`. The permission request must come from a user gesture. No Apple Developer account is needed. The Badging API is supported. MDN BCD: `safari_ios` "16.4", "Notifications are supported in web apps saved to the home screen." `webview_ios`: not supported (so no push in in-app browsers). | [WebKit blog: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Apple: Sending web push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [MDN BCD PushManager.json](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/PushManager.json) |
| macOS Safari | Safari 16 on macOS 13 Ventura or later, in normal web pages (no install needed). | Apple doc, MDN BCD |
| **Android Chrome** | Supported. `chrome_android` mirrors Chrome 42, so no install is needed. Android WebView: not supported. | MDN BCD |
| Desktop | Chrome 42+, Edge 17+, Firefox 44+ (Firefox Android 48+), Opera and Samsung Internet (mirrored). The Push API is "Baseline: Widely available" since March 2023. | MDN BCD, [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) |

Apple-specific rules (from the Apple doc above):
- **No silent push.** "Present push notifications to the user immediately after your service worker receives them. If you don't, Safari revokes the push notification permission for your site." The service worker must always call `showNotification`.
- Payload must be **4 KB** or less (413 / `PayloadTooLarge`).
- **VAPID is required.** The JWT `aud` must be the push-service origin, and `exp` can be no more than 1 day in the future. "Don't refresh your JWT more frequently than once per hour." Allow outbound requests to `https://*.push.apple.com`.
- `TTL` header is required (stored up to 30 days). `Urgency` can be `very-low`, `low`, `normal`, or `high`.

### 3.2 Can a Cloudflare Worker send VAPID web push?

**Yes.** Every primitive needed is available. Web Push needs ECDSA P-256 for the VAPID JWT ([RFC 8292](https://www.rfc-editor.org/rfc/rfc8292)), plus ECDH P-256, HKDF, and AES-128-GCM for `aes128gcm` payload encryption ([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291), [RFC 8188](https://www.rfc-editor.org/rfc/rfc8188)).
- Workers Web Crypto marks ECDSA sign/verify, ECDH deriveBits, HKDF, AES-GCM, and HMAC as supported. **UNCERTAIN:** the table doesn't list curve names (P-256) or import formats explicitly. In practice the P-256 curve is standard. [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- With `nodejs_compat`, "All `node:crypto` APIs are fully supported" except DSA/DH key generation, argon2, ed448/x448, `randomUUIDv7`, and FIPS toggling. That means `createECDH`, `hkdf`, and `aes-128-gcm` ciphers work. The page says `nodejs_compat` must be added for compatibility dates before 2026-08-04. [Workers node:crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)
- Library: **[@pushforge/builder](https://github.com/draphy/pushforge)** (MIT, zero dependencies, "Node.js 20+ or any runtime with Web Crypto API") lists Cloudflare Workers as supported and handles VAPID and payload encryption. **UNCERTAIN:** its README doesn't cite RFC 8291 or `aes128gcm` by name, and the repo shows no tagged releases, so test it against a real FCM / Mozilla / Apple endpoint before relying on it. The classic `web-push` npm package depends on Node `https`/`crypto` modules. It might work under `nodejs_compat`, but that is not verified. A hand-written implementation of about 150 lines on Web Crypto is a fallback.
- Constraints on Free: **50 subrequests per invocation**, so at most about 45 pushes per run after the DB calls (fine for a handful of friends). Also 10 ms CPU. **UNCERTAIN:** how much of the 10 ms the Web Crypto ops use. Cache the VAPID JWT for each push-service origin for at least 1 hour, as Apple asks, so each push costs only one ECDH, HKDF and AES-GCM pass. Measure before you assume it fits.

---

## 4. Recommendation: who owns the simulation tick?

**Let a Cloudflare Worker Cron Trigger own the clock. Supabase stays the source of truth.**

1. **One Cron Trigger, `* * * * *`** (1 of the 5 allowed). On each run the Worker decides whether a tick is due:
   - If any player was seen in the last few minutes (a `last_seen` column, updated by the client at most once a minute), tick every minute.
   - Otherwise, tick when `now - last_tick >= 5 min`.
   - Total cost: 1,440 invocations/day, about 1.4% of 100k/day.
2. **Run the engine where the CPU budget fits:**
   - **Default: the TS rules engine runs inside the Worker** if a tick fits in **10 ms CPU**. I/O waits are free, so the work is: 1 RPC to read the world, compute, 1 RPC to write the tick. Measure this with the Workers CPU-time metrics.
   - **If ticks outgrow 10 ms:** the Worker calls a **Supabase Edge Function** (2 s CPU, 150 s wall; about 44.6k of 500k invocations/month) or a Postgres RPC that holds the logic. The Worker stays the trigger.
3. **This keeps Supabase awake for free.** Every tick is an external PostgREST/RPC call, which is the kind of "API calls / real requests from your app" activity the docs say counts. Ticks come every 1 to 5 min, far more than "a few requests a day". pg_cron is not documented as activity, and it can't wake a project that has already paused, so **don't use pg_cron as the clock or as a keep-alive**. It's also Beta, and its Free availability isn't stated outright.
4. **Realtime:** after each tick, send **one** broadcast through the Realtime REST API. Clients refetch the state they need. Avoid Postgres Changes on high-churn tables, which could use more than the 2M messages/month.
5. **Push:** the same Worker sends Web Push for notable events (for example "your captain fell into a latrine") with a Web Crypto VAPID library. Stay at or under about 45 per run and under 4 KB each, and always show the notification. Tell iOS friends to "Add to Home Screen" on iOS 16.4 or later.
6. **Storage hygiene:** prune or roll up event logs to stay well under 500 MB average and the 2 GB disk. Don't put per-tick writes in KV (1,000 writes/day).

**Why not the others:**
- **pg_cron-only** risks the pause and can't recover from it.
- **Client-driven ticks** stop when nobody is online and can't be trusted.
- **All-Cloudflare** (Durable Object alarms, D1, DO WebSockets) would avoid pausing entirely and fits Free (SQLite DO, 100k req/day), but it means rebuilding Auth and Realtime. Keep it as a fallback if Supabase changes its pausing rules.

**Residual risks:**
- Supabase never defines "sufficient activity".
- Cloudflare cron timing isn't guaranteed to the second.
- The 10 ms Worker CPU limit for engine plus push is unmeasured.
- Supabase says "Free plan compute is subject to change". Re-check these pages if behaviour changes.
