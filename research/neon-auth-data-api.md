# Neon Auth and Data API for magic links and RLS

Ticket: [#49 "Neon Auth and Data API for magic links and RLS"](https://github.com/abdullah12353/orc-simulator/issues/49), on map [#47](https://github.com/abdullah12353/orc-simulator/issues/47).
Researched: 2026-11-05. Every source was accessed on **2026-11-05**. Each Neon page shows its own "Last updated" date, given next to it below.
Sources are Neon's docs and changelog, the npm registry and published package source, Better Auth's docs, Cloudflare's docs and Resend's docs. Anything they don't settle is marked **UNCERTAIN**. Facts only: the choices belong to #52 (Auth and Player identity) and #53 (Browser data access path).

Naming: Neon now calls its auth product **Managed Better Auth** (it was "Neon Auth"). The older Stack Auth-based Neon Auth (`neon_auth.users_sync`) is legacy and "no longer accepting new users" ([migrate from legacy](https://neon.com/docs/auth/migrate/from-legacy-auth), 2026-10-09). Ignore any guide that mentions `users_sync`.

---

## Short answer

- **Yes, in shape.** Managed Better Auth plus the Data API reproduce "the browser talks to Postgres under RLS". The JWT carries `sub` (user id) and `role: "authenticated"`. The Data API switches to that role. `auth.uid()` returns the `sub` as a uuid, so the **six `auth.uid()` call sites and the `authenticated` grants in our migrations keep their names and meaning**.
- **Magic links: yes. Own email through Resend: yes, two ways.** Either custom SMTP (Resend has SMTP), or a `send.magic_link` webhook that hands us the link to send ourselves. Free plan: 60k MAU per project. Neither the docs nor the pricing page say whether custom SMTP or webhooks are limited to paid plans (UNCERTAIN, though nothing suggests they are).
- **Data API: GA, $0, and it wraps `@supabase/postgrest-js` itself.** `@neon/postgrest-js` 0.3.0 depends on `@supabase/postgrest-js` 2.79.0, so our 54 `.from()` and 19 `.rpc()` calls should carry over largely unchanged. Free has no separate Data API limit. It spends the project's 100 CU-hours and 5 GB egress.
- **The catches:**
  1. **Session cookie on a third-party domain.** The SPA on Cloudflare Pages and the auth endpoint on `*.neonauth.*.aws.neon.tech` are different sites. The session is an HttpOnly cookie on the auth domain. Neon's docs say nothing about Safari or iOS third-party cookie blocking. This is the biggest UNCERTAIN, and a 15-minute prototype on an iPhone PWA settles it.
  2. **Neon's Supabase-compat auth adapter turns `signInWithOtp` into a 6-digit code, not a magic link.** To keep magic links we have to call Better Auth's `signIn.magicLink` instead.
  3. Nothing in the docs says we may foreign-key to `neon_auth.user` (UNCERTAIN).
  4. Every browser query wakes and bills the single Postgres compute (that's for #48 to budget).
- **Fallback (Better Auth in a Worker) runs at $0.** It needs nothing beyond what we already have: Workers Free, Neon Free and Resend. The Data API accepts any JWKS, Better Auth's JWT plugin publishes one, and `definePayload` adds the `role` claim. The risk there is Workers Free's 10 ms CPU per request. Magic links don't hash passwords, so they fit easily, but session and DB round trips must stay lean.

---

## 1. What we use today (repo facts, `build/mvp` at d23ba1e)

| Fact | Where |
|---|---|
| One `createClient(url, anonKey)` from `@supabase/supabase-js`. | `apps/web/src/supabase.ts` |
| Sign-in is `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })`, a **magic link**. The redirect goes back to `/join/<token>` when an invite is pending, and the UI says "Check your email for the magic link". Also used: `getSession`, `onAuthStateChange`, `getUser` (2×), `signOut`. | `apps/web/src/App.tsx:30-115`, `hall-data.ts:194`, `LiveStage.tsx:34` |
| **54 `.from()` calls over 25 tables/views**, all reads (`select`). Builder features used: `eq`, `neq`, `in`, `is`, `gt`, `order`, `limit`, `range`, `single`, `maybeSingle`, and `select('id', { count: 'exact', head: true })` (meddle-data.ts). No inserts, updates, deletes or resource embedding from the browser. | `apps/web/src/*.ts(x)` excluding tests |
| **19 `.rpc()` calls over 13 functions**: `my_player` (4), `submit_intent` (4), `begin_first_open`, `see_hint`, `mark_seen`, `invite_info`, `join_world`, `create_invite`, `revoke_invite`, `rap_sheet`, `trace_back`, `subscribe_push`, `unsubscribe_push`. | same |
| Also `supabase.functions.invoke` (3: `create-world`, `open-edition`, `create-clipping`) and one `supabase.channel` (Realtime). Those are other tickets, but they share the same client and token. | `App.tsx:231`, `Herald.tsx:172`, `clipping-data.ts:21`, `live.ts:50` |
| The server-side user check asks Supabase Auth: `supabaseUserResolver` calls `GET {url}/auth/v1/user` with the bearer token. Every user endpoint takes an injected `getUserId(req)`, so swapping in a JWKS check is a one-function change. | `packages/server/src/http.ts:150-162`, `:79-112` |
| Migrations (21 files): `auth.uid()` 6 hits in 3 files (`is_world_member`, `owns_player`, `my_player`, `invite_info`, `join_world`, `mark_seen`). `auth.users` **1 hit**: `players.user_id uuid not null references auth.users (id)`. | `supabase/migrations/20261030000000_world_that_ticks.sql:27`, `…002500_invites_and_joining.sql`, `…003100_live_watching.sql` |
| `anon`: 36 hits, **all `revoke`s**. Nothing is granted to `anon`, so the browser does nothing signed out. Even `invite_info` needs sign-in. `authenticated`: 81 hits (select grants on tables/views, execute on functions). `service_role`: 10 hits, mostly `grant execute … to authenticated, service_role` and `revoke update, delete, truncate on facts/fact_causes/fact_blame/infamy_gains from service_role`. | `supabase/migrations/*` |
| 10 files use `security definer`. Views mostly use `security_invoker = true`, except `backers` (`security_invoker = false`, on purpose). | `…003600_backing.sql:46`, `…004000_hall_of_shame.sql` |
| The DB tests impersonate a Player with `set_config('request.jwt.claims', '{"sub":…,"role":"authenticated"}', true)`. | `packages/server/test/support.ts:49,64`, `test/live.test.ts:167` |

---

## 2. Managed Better Auth (Neon Auth)

### 2.1 Status, limits, where it runs

| Fact | Source |
|---|---|
| "Managed Better Auth is generally available." | [Roadmap](https://neon.com/docs/auth/roadmap), 2026-09-17 |
| Built on Better Auth, as "a managed REST API service". It currently runs Better Auth **1.7.12**. Data lives "in the `neon_auth` schema, queryable with SQL". | [About](https://neon.com/docs/auth/about), 2026-10-30 |
| **Free: up to 60,000 MAU per project.** Launch and Scale: up to 1M. | [About](https://neon.com/docs/auth/about); [Plans](https://neon.com/docs/introduction/plans), 2026-11-04 |
| "Currently available for AWS regions only." Not available with IP Allow or Private Networking. | [About](https://neon.com/docs/auth/about) |
| Each branch gets its own isolated auth environment (users, config). | [Overview](https://neon.com/docs/auth/overview), 2026-09-29 |
| Changelog: 2026-09-18 "The Neon backend is generally available" ("users and sessions live in your neon_auth schema … protected by RLS"). 2026-10-16 Better Auth 1.7 upgrade. 2026-10-30 SDK renamed `@neon/auth`. | [Changelog](https://neon.com/docs/changelog) (latest entry 2026-10-30) |
| Free plan: "$0/month … permanent (not a trial); no credit card required." Auth is included on Free. | [Pricing](https://neon.com/pricing), 2026-10-31 |

### 2.2 Magic link and OTP

| Fact | Source |
|---|---|
| Magic link: "full support for the Magic Link plugin APIs through the Neon SDK". The client call is `authClient.signIn.magicLink({ email, callbackURL })`. Link expiry is configurable from 5 to 1440 minutes (default 5). `disable_sign_up` controls whether a link can create a new account. The plugin must be enabled (Settings → Better Auth, since 2026-10-09). | [Magic Link](https://neon.com/docs/auth/guides/plugins/magic-link), 2026-10-09 |
| Email OTP: supported. Codes are "time-limited and rate-limited" (no numbers given). Calls: `emailOtp.sendVerificationOtp({ email, type: 'sign-in' })`, then `signIn.emailOtp({ email, otp })`. | [Email OTP](https://neon.com/docs/auth/guides/plugins/email-otp), 2026-11-05 |
| Redirects go only to **trusted domains**. Wildcards are allowed (e.g. `https://*.my-app-preview.vercel.app`); `*.pages.dev` isn't named but follows the same pattern. Localhost on any port is allowed automatically ("Allow Localhost" should be turned off for production). | [Configure domains](https://neon.com/docs/auth/guides/configure-domains), 2026-09-16; [Production checklist](https://neon.com/docs/auth/production-checklist), 2026-10-09 |
| **The Supabase-compat adapter does not do magic links.** In `@neon/auth` 0.8.2, `SupabaseAuthAdapter.signInWithOtp({ email })` calls `emailOtp.sendVerificationOtp({ type: 'sign-in' })`, which sends a code and ignores `emailRedirectTo`. `verifyOtp({ type: 'magiclink' })` returns `MagicLinkNotSupported: "Magic link verification is not supported. Use email OTP authentication instead."` A drop-in swap of `supabase-js` would silently change our sign-in from a link to a code. Magic links need the Better Auth adapter (`signIn.magicLink`). | Published package source, `@neon/auth@0.8.2` `dist/vanilla/adapters/index.js` lines 282-306, 596-611 (npm, published 2026-10-30) |
| Other adapter facts from the same file: `signInAnonymously`, phone OTP, `setSession` and token-hash verification return "not supported". `getSession`, `getUser`, `signOut` and `onAuthStateChange` are implemented. | same |

### 2.3 Sending through our own email (Resend)

| Fact | Source |
|---|---|
| Default is Neon's shared sender (`auth@mail.myneon.app`). "The default shared SMTP should be used only during development." It "is rate-limited and does not support verification links" (no numbers given). | [Magic Link](https://neon.com/docs/auth/guides/plugins/magic-link); [Production checklist](https://neon.com/docs/auth/production-checklist); [Neon managed-auth skill reference](https://neon.com/docs/ai/skills/neon-auth/references/managed-auth.md) (undated) |
| **Option A, custom SMTP**: Console fields are host, port, username, password, sender email and sender name. It changes the sender, not the template ("if you only need a custom sender address without changing the email content"). Dashboard templates "aren't available yet". | [Production checklist](https://neon.com/docs/auth/production-checklist); [Customize emails](https://neon.com/docs/auth/guides/customize-emails), 2026-09-16 |
| Resend speaks SMTP: host `smtp.resend.com`, ports 465/587 (and others), username `resend`, password = API key. That's the same shape we use for Supabase today. | [Resend SMTP](https://resend.com/docs/send-with-smtp) (undated) |
| **Option B, webhook**: subscribe to `send.magic_link` (and/or `send.otp`), and Neon "skips its default email" and POSTs to our endpoint. The payload includes `link_url` ("Full verification URL with embedded token"), a raw `token`, and `user.email`. It is signed with Ed25519 detached JWS (`X-Neon-Signature`, keys at `<NEON_AUTH_URL>/.well-known/jwks.json`). Timeout 1-10 s (default 5), at most 3 immediate retries, 15 s total. A Worker can receive it and call Resend's API with our own template. | [Webhooks](https://neon.com/docs/auth/guides/webhooks), 2026-09-16 |
| **UNCERTAIN:** none of the auth docs or the plans page says whether custom SMTP or webhooks are limited to a plan. They are never listed as paid-only. | [Plans](https://neon.com/docs/introduction/plans), [Pricing](https://neon.com/pricing) |

### 2.4 Tokens, and how the user id reaches SQL

| Fact | Source |
|---|---|
| The browser session is an HttpOnly cookie `__Secure-neonauth.session_token` (an opaque token, not a JWT), `Secure`, `SameSite=None`, set on the auth host. The SDK gets a JWT, keeps it as `session.access_token`, and sends `Authorization: Bearer <jwt>` to the Data API. | [Authentication flow](https://neon.com/docs/auth/authentication-flow), 2026-09-16 |
| The JWT is EdDSA (Ed25519) and lasts 15 min, refreshed by `authClient.token()`. Claims include `sub` (= `neon_auth.user.id`), `role: "authenticated"`, `email`, `iss`, `aud`. "Custom claims aren't supported." JWKS: `<NEON_AUTH_URL>/.well-known/jwks.json`. Verify in a backend with `jose`'s `createRemoteJWKSet` and `jwtVerify(token, JWKS, { issuer })`. | [JWT plugin](https://neon.com/docs/auth/guides/plugins/jwt), 2026-09-16 |
| In SQL: "`auth.user_id()` returns the JWT `sub` claim as `text`." "`auth.uid()` parses `sub` as a UUID and returns `NULL` if it's not valid." **Our existing `auth.uid()` calls keep their meaning.** | [Data API get started](https://neon.com/docs/data-api/get-started), 2026-10-09; [Authentication flow](https://neon.com/docs/auth/authentication-flow) |
| These functions come from Neon's open-source **`pg_session_jwt`** extension (`auth.init`, `auth.jwt_session_init(jwt)`, `auth.user_id()`, `auth.uid()`, `auth.jwt()`, `auth.session()`). It "is portable to any Postgres provider or self-managed Postgres". With no JWK configured, it falls back to PostgREST's `request.jwt.claims` setting, which "can be modified by any database user", so it must be set in a trusted way. Our tests already set exactly that GUC (§1), so plain Postgres plus `pg_session_jwt` should run them unchanged. The Neon docs don't say outright that the Data API uses this extension (UNCERTAIN, but the function names and semantics match). | [pg_session_jwt README](https://github.com/neondatabase/pg_session_jwt) (no release dates shown; 40 commits) |

### 2.5 Where users live (the `auth.users` foreign key)

| Fact | Source |
|---|---|
| Users are in `neon_auth.user` (`SELECT id, email, "createdAt" FROM neon_auth.user`). The user id type is listed as **UUID**, the same as Supabase's. | [Migrate from Supabase](https://neon.com/docs/auth/migrate/from-supabase), 2026-09-16 |
| The schema is "protected by RLS" and branches with the database. | [Changelog 2026-09-18](https://neon.com/docs/changelog/2026-09-18) |
| **UNCERTAIN:** no current Managed Better Auth page says whether app tables may declare `references neon_auth.user (id)`, or what happens to such a key when Neon manages that schema (migrations, deletes). The only FK guidance found is for the *legacy* `neon_auth.users_sync`. Check in a prototype by running `\d neon_auth.user` and adding the FK on a branch, or keep `players.user_id` as a plain uuid with no FK. | — |

### 2.6 The cross-site cookie risk (SPA on Pages, auth on Neon's domain)

| Fact | Source |
|---|---|
| Example auth URL: `https://ep-xxx.neonauth.us-east-2.aws.neon.build/neondb/auth`. That is a different *site* from `*.pages.dev`. | [React quick start](https://neon.com/docs/auth/quick-start/react), 2026-10-09 |
| Vite + React is "✅ Supported". "Standalone frontend + backend" is "🔜 Coming soon" because "these cookies cannot be securely shared between frontend and backend applications on different domains". | [Roadmap](https://neon.com/docs/auth/roadmap) |
| `cookies.domain` "shares session cookies across subdomains of one parent domain", "not cookie sharing across unrelated frontend and backend hosts". For Next.js, Neon's own pattern is a **same-origin proxy** (`app/api/auth/[...path]`). Nothing equivalent is described for Vite. | [Managed-auth skill reference](https://neon.com/docs/ai/skills/neon-auth/references/managed-auth.md) |
| The SDK's own troubleshooting table lists "Session always null, Cause: Cookies blocked". The SDK passes a one-time `neon_auth_session_verifier` URL param after redirects to bootstrap the session. | `@neon/auth@0.8.2` `llms.txt` line 305, `dist/adapter-core.js` 505-545 |
| Better Auth's docs say Safari's ITP treats an auth API on another domain as third-party and can block its cookies, which shows up as users who look signed out. The fixes are a reverse proxy through the frontend's own domain, or a shared parent domain. | [Better Auth: Cookies](https://better-auth.com/docs/concepts/cookies) (current docs, v1.7) |
| **UNCERTAIN, and the one to test first:** whether a magic-link sign-in survives reloads in an installed iOS Safari PWA on `*.pages.dev` with no proxy. If it doesn't, the known way round it is a same-origin proxy on Cloudflare (a Pages Function or a Worker route under our domain that forwards `/auth/*` to the Neon Auth URL). That is a small $0 Cloudflare piece, but it is a piece. | inference from the rows above |

---

## 3. Neon Data API

| Fact | Source |
|---|---|
| "Fully compatible with PostgREST." It's a "Rust-based re-implementation of PostgREST built to run as a shared service across the Neon fleet", "built directly into Neon's proxy". It launched in beta on 2025-10-02. | [Data API overview](https://neon.com/docs/data-api/overview), 2026-09-30; [Neon blog, 2025-10-02](https://neon.com/blog/a-postgrest-compatible-data-api-now-on-neon) |
| **Status: GA.** The 2026-09-18 changelog lists it among the generally available backend services. Current docs carry no beta label. | [Changelog 2026-09-18](https://neon.com/docs/changelog/2026-09-18); [Get started](https://neon.com/docs/data-api/get-started) |
| **Free: included, "No separate charge"**, no request cap listed. "Queries use your compute, and responses count toward network transfer." Free is 100 CU-hours per project per month, scale-to-zero after 5 min idle (can't be turned off), and 5 GB egress per project shared across all products. "Running out of CU-hours or egress suspends compute until the next billing period." | [Plans](https://neon.com/docs/introduction/plans), 2026-11-04; [Pricing](https://neon.com/pricing), 2026-10-31 |
| URL shape: `https://<endpoint>.apirest.<region>.aws.neon.tech/<db>/rest/v1/<table>`. It's configured **per branch**. | [Get started](https://neon.com/docs/data-api/get-started) |
| **Client: `@neon/postgrest-js` 0.3.0 depends on `@supabase/postgrest-js` 2.79.0.** `@neon/neon-js` 0.10.2 bundles it with `@neon/auth` 0.8.2, and `@neon/auth` itself depends on `@supabase/auth-js` 2.79.0 and `better-auth ~1.7.12`. The query builder is Supabase's own code, so `range`, `single`, `maybeSingle` and `count: 'exact', head: true` exist client-side. Neon's SDK page documents only a subset (`from/select/insert/update/delete/rpc`, the usual filters, `order`, `limit`), so check server-side support for `count` and `range` in the prototype. | `npm view` 2026-11-05 (`@neon/postgrest-js` modified 2026-10-26, `@neon/neon-js` and `@neon/auth` modified 2026-10-30); [JavaScript SDK](https://neon.com/docs/reference/javascript-sdk), 2026-08-31 |
| Drop-in path: `createClient` from `@neon/neon-js/supabase`. "Your existing `client.from()` queries work without any code changes." (See §2.2 for the sign-in catch.) No `functions.invoke` or `channel` in the Neon SDK docs. | [Migrate from Supabase](https://neon.com/docs/auth/migrate/from-supabase); [JavaScript SDK](https://neon.com/docs/reference/javascript-sdk) |
| Bring-your-own client: `new NeonPostgrestClient({ dataApiUrl, options: { global: { fetch: fetchWithToken(getToken) } } })` works with any JWT provider. | [Get started](https://neon.com/docs/data-api/get-started) |
| **Roles:** "The database role always comes from the JWT `role` claim." The default roles are **`authenticated`** and **`anonymous`** (not `anon`). Requests without a `role` claim run as `anonymous`, which "by default … has no permissions". Anonymous access still uses a JWT (`allowAnonymous: true` in the SDK). Custom roles must be granted to `authenticator`. Our migrations' `authenticated` grants carry over by name. Our `anon` revokes would target a role that doesn't exist on Neon (rename to `anonymous` or drop). | [Access control](https://neon.com/docs/data-api/access-control), 2026-09-14; [Custom auth providers](https://neon.com/docs/data-api/custom-authentication-providers), 2026-09-30 |
| No `service_role` on Neon. There's no permission layer of its own: "GRANTs and RLS authorize every request". "All tables accessed via the Data API must have RLS enabled." Server code connects as an ordinary Postgres role (whatever postgres.js uses), so the `service_role` grants and revokes need a named equivalent. That's for the migrations-rewrite item. | [Data API overview](https://neon.com/docs/data-api/overview); [RLS guide](https://neon.com/docs/guides/row-level-security), 2026-06-05 |
| Settings: exposed schemas (default `public`), max rows (default unlimited), anonymous role name, JWT audience, **CORS allowed origins** (empty = all), schema-cache refresh (`neon data-api refresh-schema`, needed after DDL). | [Manage](https://neon.com/docs/data-api/manage), 2026-09-30; [Troubleshooting](https://neon.com/docs/data-api/troubleshooting), 2026-10-09 |
| Any JWKS provider is accepted. `role: "authenticated"` and `sub` are required for RLS. `aud` is optional for most providers. **UNCERTAIN:** the docs don't say whether a custom JWKS works on Free (no plan gating is mentioned anywhere). | [Custom auth providers](https://neon.com/docs/data-api/custom-authentication-providers) |
| Not covered by any Data API page: RPC specifics (`security definer`, functions returning `setof`/tables like `invite_info`), and views with `security_invoker`. The "fully compatible with PostgREST" claim is the only coverage. **UNCERTAIN until the prototype runs `invite_info`, `submit_intent`, a `security_invoker` view and the `count`/`range` calls.** | — |

---

## 4. Fallback: Better Auth in a Cloudflare Worker, issuing JWTs for the Data API

| Fact | Source |
|---|---|
| Better Auth's latest version is 1.7.18 (2026-11-05). Auth.js (NextAuth) has been "maintained and overseen by Better Auth team" since 2025-09-22, which recommends Better Auth for new projects. Better Auth itself joined Vercel on 2026-07-07. So Auth.js isn't an independent second option any more. | `npm view better-auth` 2026-11-05; [Auth.js joins Better Auth](https://www.better-auth.com/blog/authjs-joins-better-auth) (2025-09-22); [Better Auth joins Vercel](https://better-auth.com/blog/better-auth-joins-vercel) (2026-07-07) |
| Magic link plugin: `sendMagicLink({ email, token, url, metadata }, ctx)` is our callback, so we call Resend's HTTP API directly. `expiresIn` default 300 s. `disableSignUp`. Rate limit `{ window: 60, max: 5 }` on `/sign-in/magic-link` and `/magic-link/verify`. Client: `signIn.magicLink({ email, callbackURL, newUserCallbackURL })`. | [Better Auth: Magic link](https://better-auth.com/docs/plugins/magic-link) (current docs) |
| JWT plugin: JWKS at `/api/auth/jwks`, token at `/api/auth/token`, or the `set-auth-jwt` header on `getSession`. Default **EdDSA/Ed25519** (also ES256, RS256, PS256, ES512). 15 min expiry. `definePayload` sets claims, so `role: 'authenticated'` can be added. `sub` defaults to the user id. Issuer and audience default to `BASE_URL`. | [Better Auth: JWT](https://better-auth.com/docs/plugins/jwt) (current docs) |
| That JWKS URL is what the Data API's custom-provider setting takes (§3). | [Custom auth providers](https://neon.com/docs/data-api/custom-authentication-providers) |
| Storage: Better Auth's tables would live in our Neon database (Kysely/pg adapter; Cloudflare's guidance is Hyperdrive or a Postgres driver with `nodejs_compat`). Better Auth 1.5+ also supports D1 natively. | [Better Auth 1.5](https://better-auth.com/blog/1-5); [Cloudflare: connect to databases](https://developers.cloudflare.com/workers/databases/connecting-to-databases/) |
| **Running cost at $0:** Workers Free is 100,000 requests/day, **10 ms CPU per request**, 50 subrequests, 128 MB. Plus Neon Free compute for auth queries and Resend's free tier for mail. No card needed for the Neon part. The Cloudflare page doesn't mention cards. | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), 2026-10-29; [Pricing](https://neon.com/pricing) |
| Risk: 10 ms CPU. Magic link has no password hashing (the usual Workers CPU problem), and Ed25519 signing is cheap. **UNCERTAIN** until measured, though DB wait time doesn't count as CPU. | inference from the rows above |
| Same-origin bonus: if the auth Worker is served from our own origin (a Pages Function, or a route on a custom domain), the session cookie is first-party, which removes the §2.6 risk entirely. | [Better Auth: Cookies](https://better-auth.com/docs/concepts/cookies) |

---

## 5. What #52 and #53 will need from this

- **For #52 (Auth and Player identity):**
  - Managed vs self-hosted. Managed gives magic links, Resend via SMTP or webhook, JWKS, 60k MAU and GA status at $0. Self-hosted gives a first-party cookie, our own templates, and one more Worker to run.
  - Whether `players.user_id` keeps a foreign key (to `neon_auth.user`, which is UNCERTAIN) or becomes a plain uuid.
  - Whether a cross-site cookie on iOS is acceptable, or a same-origin proxy is needed. This needs the prototype.
- **For #53 (Browser data access path):**
  - The Data API keeps the PostgREST client code (Supabase's own postgrest-js underneath).
  - Grants: `authenticated` stays, `anon` becomes `anonymous` (unused by us), and `service_role` needs a named server role.
  - Costs to budget with #48: every browser read spends the one Free compute (100 CU-hours) and egress (5 GB).
  - The `@neon/neon-js/supabase` drop-in sends codes, not magic links. Either use the Better Auth adapter, or use `@neon/postgrest-js` with our own token getter.
- **Prototype checklist** (throwaway, on a Neon Free branch, ~1 hour). Each item settles one UNCERTAIN above:
  1. Magic link via Resend SMTP: does it arrive, and does it redirect to `/join/<token>` on a `*.pages.dev` trusted domain?
  2. Session persists in an installed iOS Safari PWA after a reload.
  3. `invite_info` (returns a table), `submit_intent`, a `security_invoker` view, `count: 'exact', head: true` and `range` through the Data API.
  4. `\d neon_auth.user` and an FK from `players.user_id`.
  5. `auth.uid()` inside a `security definer` function called over RPC.

---

## Also noticed (outside this ticket, may affect siblings)

- **Neon now has Functions and Realtime.** The 2026-09-18 GA release covers "long-running Node.js compute next to your database, now with triggers and custom domains". Free gets 10 active Capacity-Hours, 400 waiting Capacity-Hours and 1M invocations per project per month. **Neon Realtime** has been in public beta since 2026-10-16 ("turns any SQL query into a live query"). It's free during the beta, only in AWS `us-east-1`, `us-east-2`, `eu-central-1` and `ap-southeast-1`. Not researched here. They bear on the Edge Function and Realtime replacements (the map's default is Cloudflare). [Plans](https://neon.com/docs/introduction/plans); [Changelog 2026-10-16](https://neon.com/docs/changelog/2026-10-16)
- Neon Auth and the Data API are both **per branch**, and so are trusted domains, users and config. Branch-based test environments get their own auth. [Overview](https://neon.com/docs/auth/overview); [Get started](https://neon.com/docs/data-api/get-started)
