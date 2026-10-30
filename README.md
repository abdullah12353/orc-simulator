<img src="assets/icon.svg" width="64" height="64" alt="">

# orc-simulator (ORC NONSENSE)

Design: [GLOSSARY.md](GLOSSARY.md), [.scratch/orc-nonsense/](.scratch/orc-nonsense/) (gdd, data-model, tone bible).

## Layout (npm workspaces)

| Path | What |
|---|---|
| `packages/content` (`@orc/content`) | The typed content bundle, its validator, and `contentVersion` |
| `packages/sim` (`@orc/sim`) | Pure deterministic sim: `simulate`, `applyDiff`, `castWorld`, `stateHash`, `tickSeed` |
| `packages/server` (`@orc/server`) | Portable Edge Function core (tick, create-world) on postgres.js |
| `supabase/` | `config.toml` (ports 55420–55429), migrations, thin Deno entrypoints in `functions/` |
| `apps/web` (`@orc/web`) | React + TS PWA (Vite, Cloudflare Pages) |
| `apps/clock` (`@orc/clock`) | Cloudflare cron Worker: POSTs the tick endpoint every minute, nothing else |

TS sources import each other with explicit `.ts` extensions so the same files run under Node
(`--experimental-strip-types`), Deno and Vite with no build step.

## Commands

```sh
npm install
npm run typecheck        # tsc for packages, web and clock
npm run content:check    # CI content validation
npm test                 # Seam A (sim + content), ORC_SEEDS=<n> for longer multi-seed runs
npm run db:start         # start the local Supabase stack (under the shared DB lock)
npm run test:db          # Seam B: lock, reset the DB to this checkout's migrations, run integration tests
npm run smoke:local      # magic link → create-world → tick endpoint → Facts, through the served stack
npm run web:env && npm run dev:web   # PWA on http://127.0.0.1:5173 (magic-link mail: http://127.0.0.1:55424)
npm run dev:clock -- 5   # tick the local stack every 5 s, like the clock Worker
```

## Deploying

The first deploy runs through a guided setup script in Git Bash, with Docker Desktop running:

```sh
bash scripts/setup-deploy.sh
```

It walks you through every account step in order:

- Supabase: create the project, push the migrations, set the function secrets and deploy the functions.
- Cloudflare: Pages for the PWA, Workers AI, and the clock Worker.
- Groq: an API key, with Zero Data Retention turned on.
- Resend: SMTP for magic-link emails.
- VAPID keys for pushes.
- The real Gemma Neuron rate for `packages/server/src/narration/quota.ts`.

Every value you enter is saved to `.env.deploy`, which git ignores. If you run the script again, it remembers what you've already entered.
