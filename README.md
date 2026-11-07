<img src="assets/icon.svg" width="64" height="64" alt="">

# orc-simulator (ORC NONSENSE)

Design: [GLOSSARY.md](GLOSSARY.md), [.scratch/orc-nonsense/](.scratch/orc-nonsense/) (gdd, data-model, tone bible), and
[ADR 0001](docs/adr/0001-off-supabase-onto-neon-and-durable-objects.md) for why the stack is what it is.

## Stack

Everything runs on free plans: Neon Free and Cloudflare Workers Free.

| Piece | Where | What it does |
|---|---|---|
| Postgres | Neon project `orc-nonsense`, AWS London (eu-west-2) | The game's state. The default branch is production; a persistent `dev` branch carries local dev and `smoke` |
| Sign-in | Neon Auth (Managed Better Auth) | Magic links (60-min expiry) sent by Gmail SMTP as "The Gutter Herald". Email and password on `dev` only, for `smoke` |
| Reads and Player RPCs | Neon's Data API | The PWA reads Postgres directly with the Neon Auth JWT; RLS is the boundary |
| World jobs and the clock | One Cloudflare Worker, `orc-worker` | A thin router that checks the JWT, a Durable Object per world (its tick, create-world, the Herald, clippings, narration, pushes, live sockets), the 30-min catch-up cron, and a KV list of worlds |
| Narration | Workers AI (the `AI` binding), Groq as the fallback | |
| The PWA | Cloudflare Pages, `orc-simulator.pages.dev` | React + Vite |

## Layout (npm workspaces)

| Path | What |
|---|---|
| `packages/content` (`@orc/content`) | The typed content bundle, its validator, and `contentVersion` |
| `packages/sim` (`@orc/sim`) | Pure deterministic sim: `simulate`, `applyDiff`, `castWorld`, `stateHash`, `tickSeed` |
| `packages/server` (`@orc/server`) | Runtime-neutral server core on postgres.js: the tick and catch-up, create-world, open-edition, clippings, narration, pushes, JWT checks, the usage guard |
| `db/` | `migrations/` (applied by `scripts/migrate.mjs`), and Seam B's local Postgres: `compose.yaml`, `local-shim.sql` |
| `apps/web` (`@orc/web`) | React + TS PWA (Vite, Cloudflare Pages) |
| `apps/worker` (`@orc/worker`) | The one Cloudflare Worker: router, world Durable Object, cron, KV world list (`wrangler.jsonc`) |
| `neon.ts` | The Neon project's config (`@neon/config`): Auth and the Data API on, new branches expire after 7 days, `dev` doesn't |
| `scripts/` | `provision.mjs` (deploys), `setup-deploy.sh` (the human steps), `smoke.mjs`, `migrate.mjs`, `web-env.mjs` and the content and voice tools |

TS sources import each other with explicit `.ts` extensions so the same files run under Node
(`--experimental-strip-types`), wrangler and Vite with no build step.

## Commands

```sh
npm install
npm run typecheck        # tsc for packages, web and worker
npm run content:check    # CI content validation
npm test                 # Seam A (sim + content), ORC_SEEDS=<n> for longer multi-seed runs
npm run test:db          # Seam B: Postgres 18.6 in Docker, this worktree's own database reset to its migrations
ORC_DB_URL=<url> npm run db:migrate   # apply the migrations not yet applied to a database
```

## Local dev, against the `dev` branch

Local dev and the end-to-end test use the Neon project's persistent `dev` branch, with the Worker under
`wrangler dev`. You need the Neon CLI (`npm install -g neon`, then `neon login`) and Wrangler logged in
(`npx wrangler login`).

`npm run provision` (below) writes the `dev` branch's values into two git-ignored files:

- `.env.local`: its connection strings, Neon Auth and Data API URLs (what `neon env pull --branch dev` writes).
- `apps/worker/.dev.vars`: the Worker's secrets and vars for `wrangler dev` (see `apps/worker/.dev.vars.example`).

Then:

```sh
npm run dev:worker       # wrangler dev --test-scheduled on :8787: the Worker, the DOs, KV and the cron
npm run web:env          # apps/web/.env.local from .env.local, with the Worker on http://127.0.0.1:8787
npm run dev:web          # the PWA on http://127.0.0.1:5173
npm run smoke            # with dev:worker running: sign in, create a world, day zero, the Herald, invites, a Rumour landing on a tick
curl 'http://127.0.0.1:8787/__scheduled?cron=*/30+*+*+*+*'   # fire the catch-up cron by hand
```

Signing in on `dev:web` sends a real magic link through the `dev` branch's Neon Auth. `smoke` signs up throwaway
`smoke-*@example.com` users with email and password instead, which only `dev` allows.

## Deploying

The first deploy is two steps, in Git Bash on Windows:

```sh
bash scripts/setup-deploy.sh            # the human steps; --from N resumes at stage N
npm run provision                       # everything else (the wizard offers to run it at the end)
```

`scripts/setup-deploy.sh` walks you through what only a person can do, and saves each value to `.env.deploy`
(git-ignored):

- Log the Neon CLI and Wrangler in.
- Make a dedicated Gmail account, turn on 2-step verification and make an app password (`GMAIL_USER`, `GMAIL_APP_PASSWORD`).
- Get a Groq API key and turn on Zero Data Retention (`GROQ_API_KEY`).

`scripts/provision.mjs` does the rest from `.env.deploy`, and is safe to re-run: each step checks what's
there and changes only what differs, so a second run in a row prints "no changes".

- The Neon project `orc-nonsense` in AWS London, and the `dev` branch.
- Neon Auth on both branches: magic links with a 60-min expiry, the trusted domains `orc-simulator.pages.dev`,
  `*.orc-simulator.pages.dev` and localhost, and email and password on `dev` only. Gmail SMTP as "The Gutter
  Herald" on production. With `GMAIL_*` blank, it warns and leaves Neon's shared test sender.
- The Data API, the migrations, then `neon data-api refresh-schema`.
- A project-scoped Neon API key for the Worker's usage guard.
- The KV namespace, then the Worker with its vars and secrets. It's only redeployed when its code, config or
  secrets changed.
- The PWA built with production's values and deployed to Pages, only when the build changed.

It writes what it learns back to `.env.deploy` (the `NEON_*` values, `WORKER_URL`, `PAGES_URL`, the VAPID keys
it makes on the first run), and drops any old Supabase, Resend and clock values. To redeploy after new audio or
art, or after a migration, run `npm run provision` again.

`node scripts/provision.mjs --env <file>` provisions from another env file. With its own names
(`NEON_PROJECT_NAME`, `WORKER_NAME`, `KV_NAMESPACE`, `PAGES_PROJECT`), that's a full throwaway stack to try
changes on. `--help` lists the options.
