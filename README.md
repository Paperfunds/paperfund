# Paperfund

Paperfund is a Solana paper-trading competition. Read [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) before changing product behavior.

The current development baseline includes:

- the Phase 0 repository and infrastructure foundation;
- the Phase 1A–1F pure competition and reward-economics domain engine;
- the corrected Phase 2 authoritative hourly PostgreSQL ledger;
- the Phase 3 Pump.fun/PumpSwap authoritative execution and forced-settlement engine;
- the Phase 4A wallet-authenticated competition API and automatic hourly lifecycle worker;
- the Phase 4B React web trading application;
- validated local PostgreSQL and Redis development infrastructure.

See [Phase 2 ledger and schema](./docs/PHASE_2_LEDGER_AND_SCHEMA.md),
[Phase 3 execution engine](./docs/PHASE_3_EXECUTION_ENGINE.md), and
[V1 API](./docs/API.md), and [web application](./docs/WEB_APP.md) for implementation details.

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

| Command                | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `npm run dev`          | Run API, worker, and web app in watch mode       |
| `npm run build`        | Compile workspaces and build the production web  |
| `npm run typecheck`    | Type-check the monorepo                          |
| `npm run lint`         | Run ESLint                                       |
| `npm run format`       | Apply Prettier formatting                        |
| `npm run format:check` | Check formatting                                 |
| `npm test`             | Run Vitest tests                                 |
| `npm run db:generate`  | Generate a Drizzle migration from schema changes |
| `npm run db:migrate`   | Apply committed database migrations              |
| `npm run db:check`     | Check database connectivity                      |

Unit tests and static validation do not require Docker. Infrastructure readiness and migrations require the local services and values from `.env`.
