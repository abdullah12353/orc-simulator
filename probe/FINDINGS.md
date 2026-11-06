# #57 Probe Neon Auth, Data API and compute: findings

Run on 2026-11-05/06 against `orc-probe` (`gentle-unit-02894440`, branch `main`, aws-eu-central-1, Free plan, Postgres 18.6).
Item 2 (iOS PWA) is HITL and still open. Results marked *(by hand)* came from one-off `neon api` / `curl` / `node -e` calls rather than a committed script.

## 1. Magic links

- **The link lands on `/join/<token>`** on the trusted domain:
  `302 → https://orc-simulator.pages.dev/join/abc123?neon_auth_session_verifier=ml-…`.
  A `callbackURL` on an untrusted domain is refused up front: `403 INVALID_CALLBACK_URL`.
- **Following the link sets no cookie.** The session comes from the landing page: `@neon/auth`'s `getSession()` passes
  `neon_auth_session_verifier` to `GET /get-session`, which returns the session, sets the cookie and sends a
  `set-auth-jwt` header. The cookie is `__Secure-neon-auth.session_token; Max-Age=604800; HttpOnly; Secure; SameSite=None; Partitioned`
  on `*.neonauth.c-8.eu-central-1.aws.neon.tech`. That's a third-party, CHIPS-partitioned cookie, which is exactly what item 2 has to test on iOS.
  The sign-in POST set no cookie, so the verifier alone is enough: whoever holds the landing URL gets the session (whether a replay works wasn't tested).
- JWT from `GET /token`: EdDSA-signed, **15 min** (`exp - iat = 900`), `sub` = the user's uuid, `role` = `authenticated`, plus email,
  `iss` = `aud` = the auth origin.
- **Webhooks work on Free.** `PUT …/auth/webhooks` with `send.magic_link` delivered within ~0.5–0.6 s, and the payload has
  `event_data.link_url`, `token`, `expires_at` and `link_type`. Catches:
  - **Neon refuses webhook URLs on Neon infrastructure** (`INVALID_WEBHOOK_URL_FORMAT`), so a Neon Function can't be the receiver. A Cloudflare Worker can.
  - **The delivery carried no signature header** (no `*sig*`, `webhook-*` or `x-neon-*`, User-Agent `Neon-Auth-Webhooks/1.0`), and the PUT has no secret field.
    The receiver needs its own guard, such as a secret path segment.
- **Custom SMTP is accepted on Free** *(by hand)*. `PATCH …/auth/email_provider` `{type: standard, host: smtp.resend.com, port: 465, …}` saved, and
  `POST …/email_provider/test` really dialled Resend (`535 Authentication credentials invalid` with a dummy password).
  **Real delivery through Resend was not tested**, because `RESEND_API_KEY` in `.env.deploy` is empty. Reverted to `shared`.
- Magic link is now **on** (15 min expiry) on the probe branch. Webhooks are off again.

## 3. Data API (`@neon/postgrest-js` 0.3.0, two real Neon Auth users)

| Call | Result |
|---|---|
| `rpc('invite_info', {token})`, returns a table | 200, an array of rows. `.single()` gives the object |
| `rpc('submit_intent', …)`, `security definer`, raises `P0001` | 200 with rows. A replay is idempotent. Another world's Player gets `400 {code: P0001, message: not_a_player}` |
| `from('roster')`, a `security_invoker` view | Each user sees only their own world's rows |
| `select('id', {count: 'exact', head: true})` | `count: 3`, `data: null`. The other user gets `count: 0` |
| `.range(5, 9)` with `count: 'exact'` | `206`, 5 rows, `count: 13`. The raw `Range: 5-9` request in `uidloop.mjs` returns `Content-Range: 5-9/13` |
| CORS preflight from `orc-simulator.pages.dev` | `Allow-Origin: *`, allows `authorization, prefer, range`, exposes `Content-Range` |
| **No `Authorization` header** | `400 missing authentication credentials`. Anonymous access needs a JWT; `invite_info` for a signed-out visitor can't be a bare call |
| After DDL | `PGRST202 … schema cache` on some instances until `neon data-api refresh-schema` (and a few seconds) |

## 4. `players.user_id → neon_auth."user"(id)`

`neon_auth."user"`: `id uuid PK default gen_random_uuid()`, `name`, `email UNIQUE`, `"emailVerified"`, `image`,
`"createdAt"`, `"updatedAt"`, `role`, `banned`, `"banReason"`, `"banExpires"`.
**The FK works** (`schema.sql`), `on delete cascade` included *(by hand)*: deleting a user via `DELETE …/auth/users/{id}` removed their `players` row.

## 5. `auth.uid()` inside `security definer` over RPC: works, except on a fresh connection

- It returns the caller's `sub`, and current_user is the owner (`neondb_owner`, session_user `authenticator`). Every uid that came back was
  the caller's or null, never someone else's, in the ~7,000 calls that compared it (`uidloop`, `uidrate`, `uidddl`).
- **Bug: on a backend connection's first request, `auth.uid()` and `auth.jwt()` are NULL inside a `security definer` function**
  (`role` = `authenticated`, `request.jwt.claims` empty). In `uidpid*.mjs`, all but 2 of the ~360 nulls came from a backend pid the script hadn't seen before (a proxy for a new connection). A cold compute makes every
  connection fresh: cold runs got 157 nulls in 360 calls, 167 in 303 and 75 in 240. Warm runs mostly got none. Calling it twice in the body doesn't help.
  - A policy that calls `auth.uid()` **inline** is never affected (240/240 cold).
  - A policy that calls a **definer helper** (our `is_world_member()` ×17, `owns_player()` ×10) **silently returns no rows**:
    168/240 cold reads of `worlds` came back empty.
  - Definer RPCs fail closed (`not_a_player`), which shows up as spurious errors.
- **Both fixes held cold, 240/240 each:**
  1. Give the helper an ignored parameter whose default calls `auth.uid()`: `my_player(w uuid, _init uuid default auth.uid())`.
     The default is evaluated as the caller, which initialises the JWT before the definer body runs. The body still calls
     `auth.uid()` itself, so a client-supplied `_init` can't spoof anything (`spoof.mjs`: passing another uuid as `_init` still returned the caller's uid).
  2. Or guard the policy inline: `using (auth.uid() is not null and my_player(world_id) is not null)`. This relies on Postgres
     evaluating the inline call first, which `AND` doesn't guarantee, so **prefer fix 1**.
  Definer RPCs called directly need fix 1 too. The real `submit_intent` and `invite_info` both reach `auth.uid()` (through `my_player`, and `invite_info`'s
  membership check); the probe's cut-down `invite_info` doesn't. Fix 1 was retested on `whoami_init` and policies, not on `submit_intent` itself.
- Schema `auth` is owned by `cloud_admin` and `neondb_owner` can't grant `usage` on it, so **`security invoker` functions
  can't call `auth.uid()`** (`permission denied for schema auth`). Only definer functions owned by `neondb_owner`, and
  stored expressions (policies, defaults), can.

## 6. Compute

- *(by hand)* Default range **0.25–0.25 CU**. Free **can** change it: `0.25–2` was accepted. `max 4` was refused (`computes of this size must have min_cu == max_cu`).
  Set back to 0.25–0.25 within seconds, with no load running in between.
- `suspend_timeout_seconds` can't be changed on Free (`modifying the suspend interval is not permitted on this account`).
- **An idle pooled connection does not keep the compute awake.** It suspended 5.5 min after the last query, and the client
  connection was still usable afterwards (the pooler woke the compute).
- **Hyperdrive (on the direct URL) does not keep it awake.** It suspended 5.2 min after one query. The next request through Hyperdrive took
  **1.5 s** end to end, against ~0.22 s warm.
- Burn: the project counters read **385 CU-s (0.107 CU-h), 1,536 s active, 6.8 MB egress**, but they lag (last updated 00:07Z) and
  miss the later runs. The compute was awake at most ~1 h, always at 0.25 CU apart from those few seconds, which means **≤ 0.25 CU-h** for the whole probe. The consumption-history API is
  paid-only (`Launch plans and above`).

## Left behind on `orc-probe`

Probe tables and functions in `public`, including the `probe_hooks` table. Magic link is on. Test users `delivered+a@resend.dev` and
`delivered+probe*@resend.dev`. The Cloudflare Workers `orc-probe-hook` and `orc-probe-hd`, the Hyperdrive config and the Neon
Function `hook` are all deleted.
