<img src="assets/icon.svg" width="64" height="64" alt="">

# orc-simulator (ORC NONSENSE)

Design: [GLOSSARY.md](GLOSSARY.md), [.scratch/orc-nonsense/](.scratch/orc-nonsense/) (gdd, data-model, tone bible).

## Layout (npm workspaces)

| Path | What |
|---|---|
| `packages/content` (`@orc/content`) | The typed content bundle, its validator, and `contentVersion` |
| `packages/sim` (`@orc/sim`) | Pure deterministic sim: `simulate`, `applyDiff`, `castWorld`, `stateHash`, `tickSeed` |
| `packages/server` (`@orc/server`) | Runtime-neutral server core on postgres.js: the tick and catch-up, create-world, open-edition, clippings, narration, pushes, JWT checks |
| `db/` | `migrations/` (applied by `scripts/migrate.mjs`), and Seam B's local Postgres: `compose.yaml`, `local-shim.sql` |
| `supabase/` | `config.toml`, left for #71 to remove |
| `apps/web` (`@orc/web`) | React + TS PWA (Vite, Cloudflare Pages) |
| `apps/worker` (`@orc/worker`) | The one Cloudflare Worker: a thin router that checks the Neon Auth JWT, a Durable Object per world that runs its tick and jobs, and the 30-min catch-up cron over a KV world list |

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
npm run smoke:local      # magic link → create-world → tick endpoint → Facts (Supabase only, until #71)
npm run web:env && npm run dev:web   # PWA on http://127.0.0.1:5173 (magic-link mail: http://127.0.0.1:55424)
npm run dev:worker       # wrangler dev --test-scheduled on :8787 (apps/worker/.dev.vars; see .dev.vars.example)
curl 'http://127.0.0.1:8787/__scheduled?cron=*/30+*+*+*+*'   # fire the catch-up cron, as the clock did
```

## Deploying

The first deploy runs through a guided setup script in Git Bash, with Docker Desktop running:

```sh
bash scripts/setup-deploy.sh            # or --from N to resume at stage N
```

It walks you through every account step in order:

- Supabase: create the project, push the migrations, set the function secrets and deploy the functions.
- Cloudflare: Pages for the PWA, Workers AI, and the clock Worker.
- Groq: an API key, with Zero Data Retention turned on.
- Resend: SMTP for magic-link emails.
- VAPID keys for pushes.
- The real Gemma Neuron rate for `packages/server/src/narration/quota.ts`.

Every value you enter is saved to `.env.deploy`, which git ignores. If you run the script again, it remembers what you've already entered.
