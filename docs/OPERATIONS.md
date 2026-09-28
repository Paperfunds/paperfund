# Operations runbook

This runbook covers the current Windows-hosted Paperfund stack: PostgreSQL and Redis in containers,
the API and worker as independent Node processes, the web build behind HTTPS, read-only creator-fee
ingestion, and operator-controlled payouts. It does not authorize a mainnet payout.

## Safety baseline

- Keep `.env` server-only and never put database, RPC, Redis, cookie, or signer secrets in a
  `VITE_*` or public browser build value.
- Bind PostgreSQL, Redis, and the Node API to loopback. Expose only an HTTPS reverse proxy.
- Leave `PAYOUT_EXECUTION_ENABLED=false`, `PAYOUT_SIGNER_TYPE=DISABLED`, and
  `PAYOUT_MAINNET_CONFIRM=false` until a reviewed payout window.
- Start creator-fee ingestion with `CREATOR_FEE_SHADOW_MODE=true`. Shadow mode records chain
  evidence, finality, cursor movement, lag, rejects, retry errors, and reconciliation findings but
  does not create canonical fee events or fund rewards.
- Use dedicated least-privilege database, Redis, RPC, and signer credentials.

## Build and preflight

Install Node 22+, npm 10+, Docker Desktop, and Git. From the repository root:

```powershell
npm ci
Copy-Item .env.example .env
docker compose up -d
npm run db:migrate
npm run build
npm run ops:check
```

`ops:check` verifies database, Redis, and Solana RPC access and prints only public mode/identity
state. A healthy result is required before startup. Confirm the returned genesis hash belongs to the
configured network. Never paste a signer secret into a ticket, log, or shell transcript.

## Process supervision

Run the API and worker independently so one can restart without taking down the other:

```powershell
npm run start:api
npm run start:worker
```

For a durable Windows installation, create two Task Scheduler tasks (or equivalent service-manager
entries), both with the repository as working directory and a dedicated unprivileged account.
Configure restart on failure with a bounded delay. Redirect stdout/stderr to separate rotating API
and worker logs through the supervisor. Do not use `npm run dev` in production: it couples watch
processes and includes the development web server.

Start order is infrastructure, migrations, API, then worker. Stop in reverse order. For a routine
restart, stop only the affected process, preserve its logs, run `npm run ops:check`, and start it
again. Database locks, unique identities, and durable checkpoints make worker replay safe.

Stop a foreground API or worker with `Ctrl+C` and wait for its exit; the worker logs
`worker_shutdown` and closes its database pool. Stop local infrastructure only after both processes:

```powershell
docker compose stop
```

API-only, worker-only, and combined restarts do not rewrite immutable financial rows. After any
restart, require `/ready`, a fresh worker tick, and unchanged payout/fee totals before declaring
recovery complete.

## Startup checklist and health commands

- `docker compose ps`: PostgreSQL and Redis are healthy and bound only to loopback.
- `npm run db:migrate` and `npm run db:check`: migrations are current and PostgreSQL is reachable.
- `npm run ops:check`: DB, Redis, and RPC pass; configured networks and safety modes are expected.
- `Invoke-RestMethod http://127.0.0.1:3000/health`: API process is alive.
- `Invoke-RestMethod http://127.0.0.1:3000/ready`: API reports DB and Redis ready.
- Worker logs show `worker_started`, a current `creator_fee_ingestion_tick` when enabled, and the
  current round lifecycle tick.
- `npm run creator-fees:status`: funding identity, cursor, success/error time, lag, and findings are
  expected.
- `npm run payout:status -- <plan-id>`: plan/execution state and configured treasury network match
  the operator's intent.
- `PAYOUT_EXECUTION_ENABLED` and `PAYOUT_MAINNET_CONFIRM` are false unless inside an authorized
  payout window.
- `ALLOWED_ORIGINS`, `PAPERFUND_API_BASE_URL`, and `PAPERFUND_APP_URL` match the HTTPS deployment.

## HTTPS and browser configuration

Terminate TLS at a maintained reverse proxy and forward only public API/web routes. Keep
`API_HOST=127.0.0.1`, set `COOKIE_SECURE=true`, select the intended SameSite policy, and list exact
HTTPS origins in `ALLOWED_ORIGINS`. Build the web app and extension with public HTTPS API/app URLs;
never expose raw Node, PostgreSQL, or Redis ports. Rebuild the extension after changing its allowed
API origin.

## Creator-fee shadow rollout

Set the reviewed Paperfund mint and creator wallet, then enable shadow ingestion:

```text
CREATOR_FEE_INGESTION_ENABLED=true
CREATOR_FEE_SHADOW_MODE=true
CREATOR_FEE_NETWORK=mainnet-beta
PAPERFUND_TOKEN_MINT=<reviewed mint>
PAPERFUND_CREATOR_WALLET=<reviewed creator>
```

Restart only the worker. Inspect `npm run creator-fees:status` and structured worker events:
`worker_started`, `creator_fee_ingestion_tick`, `creator_fee_rpc_retry`, and
`creator_fee_ingestion_tick_failed`. Track poll/candidate/verified/rejected/retry counts, cursor
movement, maximum observed slot lag, finalized observations, rollbacks, and open reconciliation
findings. A healthy restart resumes from `latest_signature`, does not duplicate observations, and
does not create `creator_fee_events` while shadow mode is true.

Keep shadow mode until the official mint/creator identity has been independently confirmed and an
observation window shows stable cursor movement, acceptable lag, understood rejection rates, no
unresolved reconciliation findings, and no canonical financial mutation. Promotion to financial
ingestion is a separate reviewed decision: set `CREATOR_FEE_SHADOW_MODE=false` and restart only
after approval.

If RPC service degrades, leave the worker running when practical: retries are bounded and lifecycle
processing has a separate failure boundary. For an extended outage, stop the worker, replace
`SOLANA_RPC_URL`, run `npm run ops:check`, then restart. The durable cursor resumes safely.

## Payout operation

Approval, dry-run, live execution, status, and reconciliation are explicit operator actions:

```powershell
npm run payout:approve -- <plan-id> <operator-identifier>
npm run payout:execute -- <plan-id>
npm run payout:execute -- <plan-id> --live
npm run payout:status -- <plan-id>
npm run payout:status -- <plan-id> --reconcile
```

The dry-run must pass before enabling execution. Verify network, RPC genesis, treasury public key,
recipient count, payout total, fee estimate, and treasury balance. Live devnet operation requires
`PAYOUT_NETWORK=devnet`, an explicitly funded devnet treasury, matching signer, and
`PAYOUT_EXECUTION_ENABLED=true`. Mainnet additionally requires `PAYOUT_MAINNET_CONFIRM=true`; keep
it false outside a separately authorized mainnet change window.

After broadcast, status is not payment proof. Reconcile until every batch and the plan are
`VERIFIED`; compare persisted signatures and exact lamports with finalized RPC records.
`FAILED_RETRYABLE` may be retried only through the guarded retry path after blockhash expiry and
proven absence. Stop on `FAILED_FINAL` or `RECONCILIATION_REQUIRED` and retain all evidence.

## Backup, restore, and incident checks

Take encrypted PostgreSQL logical backups before migrations and payout windows. A typical container
backup uses `pg_dump --format=custom`; store the result outside the repository and test restoration
into a separate database with `pg_restore --clean --if-exists`. Run migrations and `npm run db:check`
against the restored copy, then compare payout plans, allocations, executions, batches, creator-fee
checkpoints, observations, and reconciliation findings. Redis is not the financial system of record.

For incidents, first disable live payouts and preserve logs. Record UTC time, commit, configured
network (never secrets), health output, plan/source ID, signatures, and database states. Do not
delete checkpoints, observations, executions, batches, or attempts. Rotate any possibly exposed
credential outside the application, then re-run preflight.

Free RPC tiers can throttle, prune history, or impose burst limits. Warning signs are rising retry
counts, repeated timeouts or 429 responses, increasing lag, or missing historical signatures.
Reduce poll pressure within configured limits or use a provider with the required capacity; do not
weaken finality, identity, or reconciliation checks.

Common fail-closed states include `RPC_UNAVAILABLE`, stale creator-fee lag, open reconciliation
findings, insufficient treasury, disabled or mismatched signer, wrong genesis hash, unconfirmed
mainnet, expired blockhash, and on-chain intent mismatch. Preserve state and diagnose the recorded
category. To emergency-disable payouts, set `PAYOUT_EXECUTION_ENABLED=false`, restart the operator
environment, and verify `npm run ops:check`; the worker never broadcasts payouts automatically.
