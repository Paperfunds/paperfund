# Paperfund

Paperfund is a Solana paper-trading competition. Read [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) before changing product behavior.

The current development baseline includes:

- the Phase 0 repository and infrastructure foundation;
- the Phase 1A–1F pure competition and reward-economics domain engine;
- the corrected Phase 2 authoritative hourly PostgreSQL ledger;
- the Phase 3 Pump.fun/PumpSwap authoritative execution and forced-settlement engine;
- the Phase 4A wallet-authenticated competition API and automatic hourly lifecycle worker;
- the Phase 4B React web trading application;
- the Phase 4C authoritative BUY preflight, executable portfolio valuation, and browser smoke;
- the Phase 5B Chromium MV3 trading overlay for Axiom, GMGN.ai, and Terminal.trade;
- the Phase 5A authoritative creator-fee and reward-pool accounting system;
- the Phase 6A production launch configuration, readiness checks, backup/restore smoke, and public
  landing/rules surface;
- the Phase 6B approved visual identity, Chrome Web Store assets, privacy surface, and audited
  extension release packaging;
- validated local PostgreSQL and Redis development infrastructure.

See [Phase 2 ledger and schema](./docs/PHASE_2_LEDGER_AND_SCHEMA.md),
[Phase 3 execution engine](./docs/PHASE_3_EXECUTION_ENGINE.md), and
[V1 API](./docs/API.md), [web application](./docs/WEB_APP.md), and
[multi-terminal extension](./docs/EXTENSION.md) for implementation details.
Chrome Web Store listing copy, permissions/data disclosures, assets, and operator submission gates
are maintained in [the store release guide](./docs/CHROME_WEB_STORE.md).

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- Docker Desktop with Docker Compose (recommended for local PostgreSQL and Redis)

## Local setup

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d
npm run db:migrate
npm run dev
```

Open `http://127.0.0.1:5173`. The API defaults to `http://127.0.0.1:3000`; the root `npm run dev` starts the API, lifecycle worker, and Vite web app together. Use `GET /health` for process health and `GET /ready` for PostgreSQL and Redis readiness.

## Important commands

| Command                            | Purpose                                           |
| ---------------------------------- | ------------------------------------------------- |
| `npm run dev`                      | Run API, worker, and web app in watch mode        |
| `npm run build`                    | Compile workspaces and build the production web   |
| `npm run typecheck`                | Type-check the monorepo                           |
| `npm run lint`                     | Run ESLint                                        |
| `npm run format`                   | Apply Prettier formatting                         |
| `npm run format:check`             | Check formatting                                  |
| `npm test`                         | Run Vitest tests                                  |
| `npm run test:e2e`                 | Run deterministic Playwright trading smoke        |
| `npm run build:extension`          | Build the unpacked Chromium extension             |
| `npm run package:extension`        | Build, audit, and ZIP a clean store release       |
| `npm run validate:extension:store` | Audit a built extension release                   |
| `npm run dev:extension`            | Rebuild the extension in watch mode               |
| `npm run test:extension`           | Run adapter, overlay, and fixture-harness tests   |
| `npm run test:extension:headed`    | Run the loaded MV3 headed fixture acceptance      |
| `npm run test:extension:live`      | Verify safe injection on live supported terminals |
| `npm run db:generate`              | Generate a Drizzle migration from schema changes  |
| `npm run db:migrate`               | Apply committed database migrations               |
| `npm run db:check`                 | Check database connectivity                       |
| `npm run db:backup`                | Create a timestamped PostgreSQL custom dump       |
| `npm run db:restore-smoke`         | Prove a dump restores into an isolated database   |
| `npm run ops:check`                | Check DB, Redis, RPC, and safe operational modes  |
| `npm run start:api`                | Start the built API as an independent process     |
| `npm run start:worker`             | Start the built worker as an independent process  |
| `npm run payout:status -- <id>`    | Inspect or reconcile a persisted payout execution |

Unit tests and static validation do not require Docker. Infrastructure readiness and migrations require the local services and values from `.env`.

Production-oriented Windows startup, HTTPS, supervision, shadow creator-fee rollout, payout
reconciliation, backup/restore, RPC replacement, and incident procedures are documented in
[the operations runbook](./docs/OPERATIONS.md). Use the
[production launch checklist](./docs/LAUNCH_CHECKLIST.md) as the release gate. Start from
`.env.production.example` and `compose.production.yml`; neither the template nor the compose file
contains deployable secrets.

The Playwright smoke also requires local PostgreSQL from `docker compose up -d` and a one-time `npx playwright install chromium`. It creates and drops its own database, uses recorded market fixtures and a test-only wallet, and makes no external RPC or wallet request.

## Multi-terminal extension

Run `npm run build:extension`, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `apps/extension/build`. Open a Solana token page on Axiom, GMGN, or Terminal and verify the shared Paperfund overlay. The same authenticated hourly account, Paper SOL, positions, slots, and history follow the user across supported tabs; each tab retains its own current mint. The checked-in manifest key gives development installs the stable extension ID `lcnpjpkojoadojibfbjfohpjepkfmdln`.

The developer build defaults to the local API and web app. Release packaging requires the public build-time `PAPERFUND_API_BASE_URL` and `PAPERFUND_APP_URL`; run `npm run package:extension` to create the validated unpacked directory and `artifacts/paperfund-extension-0.2.0.zip`. Server-only values such as `SOLANA_RPC_URL`, `DATABASE_URL`, `REDIS_URL`, cookie/auth configuration, and private keys must never be passed to the browser build. See [multi-terminal extension](./docs/EXTENSION.md) for verified routes, exact permissions, fail-closed behavior, install, headed acceptance, recovery, and packaging procedures.
