# Paperfund web application

## Architecture

`apps/web` is the Phase 4B user-facing application. It uses React, TypeScript, Vite, React Router, and TanStack Query. The app is a thin browser client: PostgreSQL-backed API responses remain authoritative for rounds, balances, positions, fills, results, and ranks. There is no production fixture or demo-data path.

The shell has four routes:

- `/trade`: round entry, account summary, mint support inspection, BUY, positions, exact partial SELL, SELL ALL, and paginated activity;
- `/hourly`: the latest finalized hourly leaderboard;
- `/daily`: the current UTC Daily Championship leaderboard;
- `/history`: the authenticated wallet's paginated finalized hourly results.

Desktop is the primary layout. A compact sidebar is used at tablet widths and a fixed bottom navigation keeps all routes usable on mobile.

## Wallet and authentication

The browser resolves a Phantom-compatible injected provider from `window.phantom.solana` or `window.solana`. Connection and authentication are deliberately separate actions:

1. **Connect Wallet** requests the public key.
2. **Sign In** requests `POST /api/v1/auth/challenge`.
3. The wallet signs the exact UTF-8 message with `signMessage`; no transaction is created.
4. The base58 signature and exact challenge fields are sent to `POST /api/v1/auth/verify`.
5. The API establishes its opaque HttpOnly cookie session. The frontend never reads or stores the token.

An expired session produces the API's `UNAUTHENTICATED` state and the user is asked to sign in again. The frontend never requests a private key, seed phrase, transaction signature, deposit, or real swap.

## API integration and configuration

`src/api.ts` owns the API base URL, cookie credentials, error-envelope parsing, request headers, response types, and mutation calls. Set the only public runtime/build configuration with:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:3000
```

The API origin allowlist must contain the web origin. Local defaults use `http://127.0.0.1:5173` and `http://localhost:5173`. Server secrets, Redis/PostgreSQL URLs, and `SOLANA_RPC_URL` are never accessed by browser code.

Each BUY or SELL click creates a fresh cryptographically generated UUID for `Idempotency-Key`, and the pending state disables duplicate submission. Successful mutations invalidate account and history queries. Typed backend errors are mapped to specific, recoverable language; unknown errors retain the sanitized API message and never expose server stacks.

## Exact values and trading behavior

Authoritative lamports and token base units stay as strings at the API boundary and become `BigInt` only for exact client-side operations. JavaScript floating point is not used for financial decisions. Display formatting performs integer division and truncation. Partial SELL percentages floor integer base units, while 100% uses the exact stored quantity. SELL ALL sends the dedicated `"ALL"` intent so the server locks and snapshots the current position.

After a supported token is inspected, the browser loads `/api/v1/trades/buy-preflight`. The ticket displays cash, executable portfolio equity, the exact backend-provided maximum, current venue, and slot impact. MAX copies that exact value; the browser does not derive an authoritative cap. An amount above the snapshot maximum is disabled with **Exceeds 20% maximum for this order.** Preflight remains advisory, so typed cash, ratio, and slot rejections from the transactional BUY are still presented after a race.

The positions query exposes the realistic net proceeds of a full exit through the position's current Pump.fun or PumpSwap route. The UI labels this **Executable value**, calculates no price locally, displays exact signed unrealized Paper P&L from the API, and keeps entry venue separate from current venue. The account strip shows cash, exact portfolio equity, and **Live Paper P&L** (`equity - starting Paper SOL`) only when every position is available. These are provisional displays, not a persisted or finalized hourly result. Any missing valuation makes total equity unavailable rather than presenting a partial total.

## Round timing, reset, and polling

The current-round response includes server time. The browser records an offset from the response and advances the display countdown using local elapsed time, rather than trusting the local wall clock as authority. Trade controls close when persisted state is not `OPEN` or the server-offset countdown reaches zero. The backend remains final authority at every cutoff.

- round and current account: every 4 seconds;
- executable positions/account equity: after mutations and every 12 seconds;
- BUY preflight for the inspected mint: after mutations and every 12 seconds;
- hourly and daily leaderboards: every 8 seconds;
- trade history: after mutations and every 15 seconds;
- result history: on entry and explicit pagination.

When the current round ID differs from the displayed account round, the UI shows **New round available** and never labels the old account as current. The prior finalized result is shown above the next-round entry prompt when available. Settlement may continue independently.

## Testing

Component tests use a mocked injected wallet and mocked HTTP API. Coverage includes authentication states, round entry, exact backend MAX, unavailable preflight, race rejection, available/unavailable and migrated valuation, live P&L, partial SELL, SELL ALL, round transition, and leaderboard/tie rendering.

`npm run test:e2e` builds the app and runs one Chromium smoke flow through the real API and competition services. It creates a disposable PostgreSQL database, runs migrations and the lifecycle tick, uses in-memory ephemeral session storage, and supplies recorded Pump market state. A deterministic test-only Ed25519 wallet is injected before page load. The browser aborts non-local requests, so the flow needs no Phantom installation, mainnet RPC, real credentials, SOL, or external network. Docker PostgreSQL and the repository `.env` are prerequisites; install the browser runtime once with `npx playwright install chromium`.

## Known MVP limitations

- Injected message-signing wallets are supported; a wallet-selection modal is not included.
- Valuation freshness thresholds remain TBD; observation metadata is exposed and failures are explicit, but no invented stale cutoff is applied.
- The five-position valuation path is intentionally sequential and uncached; a later scale phase may add request coalescing without making cached values authoritative.
- Token name/symbol metadata is not invented; the mint is shortened for display.
- Live updates use polling, not WebSockets.
- Prize pools, rewards, payouts, browser extension, terminal overlay, admin tooling, real swaps, and deposits remain out of scope.
