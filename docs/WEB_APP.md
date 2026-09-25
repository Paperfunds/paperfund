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

The backend does not yet expose an authoritative read-only max-buy field. The MAX shortcut therefore uses a conservative 20% of current cash, which cannot exceed 20% of equity because position executable values are non-negative. This may be lower than the true permitted maximum when positions have value. The backend always reloads live position values and enforces the exact cap at submission; `MAX_BUY_RATIO_EXCEEDED` is handled explicitly.

The UI does not invent quotes, token metadata, prices, or unrealized P&L. When the account endpoint provides no valuation it says **Valuation unavailable**. Market support and the current Pump.fun/PumpSwap venue come only from `/api/v1/markets/:mint`.

## Round timing, reset, and polling

The current-round response includes server time. The browser records an offset from the response and advances the display countdown using local elapsed time, rather than trusting the local wall clock as authority. Trade controls close when persisted state is not `OPEN` or the server-offset countdown reaches zero. The backend remains final authority at every cutoff.

- round and current account: every 4 seconds;
- hourly and daily leaderboards: every 8 seconds;
- trade history: after mutations and every 15 seconds;
- result history: on entry and explicit pagination.

When the current round ID differs from the displayed account round, the UI shows **New round available** and never labels the old account as current. The prior finalized result is shown above the next-round entry prompt when available. Settlement may continue independently.

## Testing

Component tests use a mocked injected wallet and mocked HTTP API. Coverage includes unauthenticated and connected-but-unsigned states, entering a round, the BUY form and typed error, position rendering, exact partial SELL, SELL ALL, round transition, hourly ranks, daily ranks, and tie metadata. Exact-unit utilities have separate tests.

A browser E2E smoke test is deferred. Adding Playwright plus a complete fake API/wallet runtime would materially enlarge this phase; the component flow exercises the same browser interactions without live Solana RPC. No test or runtime path requires live RPC.

## Known MVP limitations

- Injected message-signing wallets are supported; a wallet-selection modal is not included.
- The backend currently returns no authoritative position valuation, so executable value and unrealized P&L remain unavailable.
- MAX is intentionally conservative until a read-only authoritative preflight API exists.
- Token name/symbol metadata is not invented; the mint is shortened for display.
- Live updates use polling, not WebSockets.
- Prize pools, rewards, payouts, browser extension, terminal overlay, admin tooling, real swaps, and deposits remain out of scope.
