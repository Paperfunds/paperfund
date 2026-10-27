# Paperfund

Paperfund is a Solana PAPER-trading competition with a Chrome extension, web dashboard, wallet-authenticated API, PostgreSQL ledger, competition worker and controlled real-SOL reward tooling. PAPER SOL and trading positions are simulated. Mainnet SOL rewards are real and require verified funding, custody, settlement and payout authorization.

This source update includes extension **0.2.2**, the current executable-quote trading composition, DURABLE_QUOTE_V2 settlement/cutoff capture, fee accounting, reward allocation, treasury controls and payout/recovery implementations. Historical experiments remain identified by `experimental`, `candidates` and diagnostic paths.

## Current status

The owner-approved October 27, 2026 context records public PAPER trading as active. The reward worker uses future-enrolled DURABLE_QUOTE_V2 evidence, retaining historical settlement REVIEW holds. Financial STOP is asserted; claims, signing, payouts and fee ingestion are disabled. Genuine hourly/full-day qualification and fresh verified funding/custody remain pending. Daily scoring and payout code do not establish live daily payouts.

Public-release clearance is incomplete. See [publication status](docs/publication/STATUS.md). Keep the repository private until history, confidentiality, third-party permissions and deployed-source provenance are cleared. The old RC1 snapshot is not the current extension.

## Components

| Path | Responsibility |
| --- | --- |
| `apps/extension` | MV3 0.2.2, Axiom/GMGN/Padre adapters, PAPER overlays, wallet auth and synchronized portfolio |
| `apps/web` | Website, trading dashboard, accounts and leaderboards |
| `apps/api/src` | API, auth, trading services, positions and P&L |
| `apps/api/isolated/current-quotes` | Current executable-quote router/capture and public production composition |
| `apps/api/isolated/verified-routes` | Verified routing and finalized provider evidence |
| `apps/worker` | UTC lifecycle, accounting, durable cutoff collection and settlement composition |
| `packages/core` | Integer rules, scoring, eligibility, ties, allocations and Reward Buffer |
| `packages/db` | Ledger, migrations, settlement, fees, treasury, payout authorization and recovery |
| `packages/execution`, `packages/protocols` | Quotes, tokens/routes, fees, simulated slippage and valuation |
| `packages/shared`, `packages/config`, `packages/testing` | Contracts, configuration and test support |
| `packages/payout-signer`, `scripts/operator` | Signer source, STOP, distribution, verification and recovery |

See [architecture](docs/ARCHITECTURE.md), [development](docs/DEVELOPMENT.md), [configuration](docs/CONFIGURATION.md) and [rules](docs/RULES.md).

## Local development

Use a separate checkout, Node.js 22+, npm 10+ and Docker Desktop for local PostgreSQL/Redis. Production keys, treasury, user data and private RPC subscriptions are not needed.

```powershell
npm ci
Copy-Item .env.example .env
docker compose up -d
npm run db:migrate
npm run dev
```

Web defaults to `http://127.0.0.1:5173`, API to `http://127.0.0.1:3000`. Authenticate with a disposable browser wallet. Default RPC is public Solana; availability and route support affect quotes. Keep signing and fee ingestion disabled. Baseline migrations do not silently install isolated current-quote schemas or production policies; see DEVELOPMENT.md.

`npm run build` compiles API, worker and TypeScript workspaces and builds the website. `npm run build:extension` creates a local extension. In `chrome://extensions`, enable Developer mode, choose Load unpacked and select `apps/extension/build`. Development identity differs from Web Store identity.

Public-origin extension build verification:

```powershell
$env:PAPERFUND_API_BASE_URL='https://api.paperfund.app'
$env:PAPERFUND_APP_URL='https://trade.paperfund.app/'
npm run build:release --workspace @paperfund/extension
```

This creates local output only. CI performs builds/tests without deployment or financial actions. Run `npm run test:extension` and `npm run test:publication` for focused offline checks. Integration suites need disposable infrastructure.

## License and branding

Original code is licensed under [Apache-2.0](LICENSE). [Third-party material](THIRD_PARTY_NOTICES.md) retains its rights and notices. Name, logo and branding are separately reserved under [BRANDING.md](BRANDING.md). See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
