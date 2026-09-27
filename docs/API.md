# Paperfund HTTP API (V1)

The product API is rooted at `/api/v1`. `GET /health` and `GET /ready` remain unversioned infrastructure endpoints. Paperfund is paper trading only: wallet signatures authenticate a user and never authorize an on-chain transaction.

## Authentication

1. `POST /api/v1/auth/challenge` with `{ "walletAddress": "..." }`.
2. Sign the returned UTF-8 `message` bytes with the named Solana wallet. Do not sign a transaction.
3. `POST /api/v1/auth/verify` with `walletAddress`, `challengeId`, the exact `message`, and a 64-byte base58 or base64 `signature`.
4. The server returns the user and sets `paperfund_session`, an opaque Redis-backed HttpOnly cookie. A bearer token is also accepted by the server. The normal web response does not expose the cookie token in JSON. A signature-verified client may explicitly send `"transport":"extension"`; only that response includes `sessionToken` so the MV3 service worker can keep the opaque token in extension session storage and use bearer transport.
5. `GET /api/v1/auth/me` reads the session. `POST /api/v1/auth/logout` revokes it.

Challenges contain the Paperfund identifier, purpose, wallet, random nonce, issued time, and expiry. They are wallet-bound, short-lived, consumed atomically, and cannot be replayed. Sessions are high-entropy, expire, and are revocable. Production must set `COOKIE_SECURE=true`; local HTTP development uses `false`. `COOKIE_SAME_SITE` defaults to `lax`.

The extension token never enters the Axiom page world or content-script UI state. It lives in `chrome.storage.session`, is read only by the background service worker, and is removed on logout or a `401`. This avoids dependence on third-party-cookie behavior without creating a second authentication system.

## Exact units and errors

All authoritative financial values are JSON strings. Paper SOL values ending in `Lamports` use 1,000,000,000 lamports per SOL. Token quantities ending in `BaseUnits` use the token's integer base units. BUY accepts deterministic decimal SOL text such as `"2"`, `"2.5"`, or `"0.125"`; it rejects signs, scientific notation, and more than nine decimals. SELL accepts a positive base-unit integer or `"ALL"`.

Errors use one envelope:

```json
{
  "error": {
    "code": "MAX_BUY_RATIO_EXCEEDED",
    "message": "The requested buy exceeds the configured maximum.",
    "requestId": "..."
  }
}
```

Domain errors map to 4xx responses; unavailable authoritative market/RPC state maps to 503; unexpected details and stack traces are never returned.

## Routes

| Method | Route                                | Auth | Description                                             |
| ------ | ------------------------------------ | ---- | ------------------------------------------------------- |
| POST   | `/api/v1/auth/challenge`             | No   | Create a single-use signing message                     |
| POST   | `/api/v1/auth/verify`                | No   | Verify Ed25519 signature and create session             |
| POST   | `/api/v1/auth/logout`                | No   | Revoke current session                                  |
| GET    | `/api/v1/auth/me`                    | Yes  | Current wallet identity                                 |
| GET    | `/api/v1/rounds/current`             | No   | Canonical persisted UTC hourly round plus server time   |
| POST   | `/api/v1/rounds/current/enter`       | Yes  | Idempotently create the fresh 10 Paper SOL account      |
| GET    | `/api/v1/rounds/current/account`     | Yes  | Cash, round, slots, and persisted open positions        |
| GET    | `/api/v1/trades/buy-preflight`       | Yes  | Advisory exact BUY limit for the requested `mint`       |
| POST   | `/api/v1/trades/buy`                 | Yes  | Authoritative Pump-origin BUY                           |
| POST   | `/api/v1/trades/sell`                | Yes  | Partial SELL or exact server-locked `ALL` SELL          |
| GET    | `/api/v1/trades`                     | Yes  | Stable descending fill history (`limit`, `cursor`)      |
| GET    | `/api/v1/positions`                  | Yes  | Positions with authoritative executable exit valuation  |
| GET    | `/api/v1/results/hourly`             | Yes  | Paginated finalized hourly results                      |
| GET    | `/api/v1/leaderboards/hourly`        | No   | Latest finalized round, or `roundId` query              |
| GET    | `/api/v1/leaderboards/daily`         | No   | Current UTC Daily Championship with tie metadata        |
| GET    | `/api/v1/competitions/daily/current` | No   | Current persisted UTC daily competition                 |
| GET    | `/api/v1/markets/:mint`              | No   | Pump-origin support and current Pump.fun/PumpSwap venue |

Trade requests require `Idempotency-Key`, a non-empty value of at most 128 characters. Its persisted fingerprint is scoped to the authenticated user/account and the financial intent. Retrying the same request returns the original result even when the HTTP request time changes; reusing a key with a different intent returns `IDEMPOTENCY_CONFLICT`.

### BUY example

```http
POST /api/v1/trades/buy
Idempotency-Key: buy-client-001
Content-Type: application/json

{"mint":"<pump-origin mint>","paperSol":"2"}
```

The server derives the Pump bonding curve, resolves migration to the canonical index-0 PumpSwap pool when necessary, loads authoritative market state, applies the 20% rule and slot/cash checks transactionally, and returns order/fill/evidence identifiers and exact updated balances.

### BUY preflight and portfolio valuation

`GET /api/v1/trades/buy-preflight?mint=<pump-origin-mint>` is an authenticated, read-only advisory. It resolves every open position through its current venue and computes, with exact integer math:

```text
portfolio equity = cash + sum(full-exit executable position values)
ratio maximum = floor(portfolio equity × max_buy_ratio_bps / 10,000)
effective maximum = min(ratio maximum, cash)
```

The response includes exact string values for cash, executable positions, equity, ratio/effective maximums, the ratio, slot usage and target-slot impact, market support/current protocol, valuation availability, and server time. Owning the target token does not reduce the per-order ratio maximum; it only means that BUY does not require another token slot. Market inspection may idempotently register public asset/market routing metadata, but preflight performs no financial mutation.

If any open position cannot be valued, `valuationStatus` is `UNAVAILABLE`, the affected position IDs are explicit, and equity/max fields are `null`. No missing position is treated as zero. The preflight is advisory: `/trades/buy` reloads market state and enforces cash, slots, and the exact ratio inside the authoritative transaction. Clients must still handle `MAX_BUY_RATIO_EXCEEDED`, `INSUFFICIENT_PAPER_SOL`, and `TOKEN_SLOT_LIMIT_REACHED`.

`GET /api/v1/positions` returns account valuation totals and one valuation per persisted position. Available values contain net full-exit Paper SOL, signed unrealized P&L (`exit value - remaining cost basis`), current protocol, evidence fingerprint, observation time/slot, and valuation time. Failures are explicit `UNAVAILABLE`, `STALE`, or `UNSUPPORTED_ROUTE` states with a sanitized reason. Historical origin venue is unchanged when the current execution route has migrated.

No valuation cache is used. The web keeps the lightweight persisted account poll at four seconds and requests executable valuations separately every twelve seconds. With at most five token slots this bounds normal display fan-out. Preflight always performs a fresh advisory valuation, and trade execution never consumes frontend or cached valuation state.

### SELL-all example

```http
POST /api/v1/trades/sell
Idempotency-Key: sell-client-001
Content-Type: application/json

{"mint":"<owned mint>","quantity":"ALL"}
```

`ALL` snapshots the current held quantity and confirms that exact quantity again under the transactional position lock. A concurrent change rejects safely and the same idempotent request may be retried; a completed retry returns its original fill. It cannot create a short position.

## Lifecycle worker

`apps/worker` polls every `WORKER_TICK_INTERVAL_MS` (default five seconds). Each tick idempotently ensures the current and next exact UTC hour plus the current UTC day, opens due rounds, discovers persisted ended `OPEN`/`CLOSING`/`SETTLING` rounds, and invokes the existing retry-safe settlement engine. The next hour opens independently while previous settlement retries. After all attributed hourly rounds are finalized, an ended daily competition becomes `FINALIZED`.

PostgreSQL remains authoritative for rounds, accounts, cash, slots, positions, orders, fills, evidence, journals, and results. Redis stores only expiring challenges, sessions, and rate-limit counters.

## Reward-pool reads (Phase 5A)

Reward reads are public and read-only. Exact lamport values are JSON strings. The current hourly and
daily endpoints return `PROVISIONAL` values while verified events can still arrive; provisional
responses never claim that dynamic smoothing is final.

- `GET /api/v1/rewards/hourly/current` returns the current hour's verified fees and provisional
  natural-hourly/daily allocation, or its frozen snapshot.
- `GET /api/v1/rewards/hourly/:roundId` returns a provisional or frozen round pool.
- `GET /api/v1/rewards/hourly/:roundId/reconciliation` returns the frozen calculation, counted
  events, baseline inputs, buffer movements, and conservation proof.
- `GET /api/v1/rewards/daily/current` returns immutable frozen contributions plus the current
  provisional daily contribution.

Raw provider payloads and internal credentials are never returned. See `docs/REWARDS.md`.

## Shadow payout reads (Phase 5C)

Shadow payout reads are exact, read-only accounting views. They never claim that SOL was sent.
Lamport amounts are JSON strings and plan states are `CALCULATED`, `FROZEN`, `VALIDATED`, or
`APPROVED`. Current generation finishes at `VALIDATED`.

- `GET /api/v1/rewards/hourly/:roundId/winners` returns the finalized hourly plan and winner
  allocations, including competition rank and tie metadata.
- `GET /api/v1/rewards/daily/:dateOrCompetitionId/winners` resolves either the UTC date or persisted
  daily competition ID and returns its finalized plan.
- `GET /api/v1/payout-plans/:id` returns the sanitized audit model: prize pool, curve/version,
  source leaderboard, rank buckets, allocations, dust adjustments, and conservation proof.
- `GET /api/v1/rewards/me` requires authentication and returns the current user's exact hourly and
  daily allocations with `PENDING` or `ALLOCATED` wording. It does not report payment.

Public payout responses use wallet display identity and omit internal user/result identifiers and
the internal stable user-ID dust ordering. Plans are generated only from finalized competition
results and frozen/final reward pools. See `docs/PAYOUTS.md` for tie pooling, cutoff behavior,
underfilled renormalization, exact rounding, lifecycle, validation, and limitations.
