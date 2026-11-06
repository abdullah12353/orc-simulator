# Neon probe (#57): throwaway, never merges

Scripts that settled the open facts from #48 and #49 against the `orc-probe` Neon project
(`gentle-unit-02894440`, branch `main`, AWS eu-central-1). Results are in the resolving comment on #57.

Secrets are read from the main checkout's git-ignored `.env.deploy` (`env.mjs`); nothing here holds one.

| File | What it does |
|---|---|
| `schema.sql` | Cut-down `worlds`/`players`/`invites`/`intents`, `invite_info`, `submit_intent`, a `security_invoker` view, and `players.user_id → neon_auth."user"(id)` |
| `diag*.sql`, `fix.sql` | `auth.uid()` probes, and the two fixes for the fresh-connection null |
| `hook/` | Neon Function that stores webhook deliveries in `probe_hooks` (deleted after use) |
| `cf-hook/` | Cloudflare Worker relaying Neon Auth webhooks to `hook/`, because Neon refuses webhook URLs on its own infra |
| `signin.mjs` | Magic link end to end with no mailbox: request, read `link_url` from the `send.magic_link` webhook, follow it, exchange the verifier, mint a JWT |
| `dataapi.mjs` | Item 3: RPCs, view, `count`/`range` through `@neon/postgrest-js` with two real users |
| `uid*.mjs`, `coldrls.mjs` | Item 5: how often `auth.uid()` is null inside `security definer`, and whether the fixes hold on a cold compute |
| `idle.mjs`, `cf-hd/` | Item 6: does an idle pooled / direct / Hyperdrive connection keep the compute awake? |

Run with `node <file>` from this directory after `npm install`.
