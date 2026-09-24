# Phase 3A: Deterministic Execution Engine and Authoritative BUY

## Scope

Phase 3A creates the execution boundary and the first end-to-end authoritative paper BUY. It does
not implement a live Solana RPC client, a production protocol, SELL orchestration, settlement, or an
API endpoint.

The implementation keeps three responsibilities separate:

- `@paperfund/core` owns pure competition rules such as executable-value portfolio equity and the
  maximum-new-buy calculation.
- `@paperfund/execution` owns normalized market-state, evidence, replay, quote, valuation, adapter,
  and registry contracts.
- `@paperfund/protocols` owns protocol math. Its only Phase 3A implementation is an explicitly named
  reference/test adapter.
- `@paperfund/db` owns PostgreSQL locks, transactions, idempotency, persistence, and journals.

## Execution contracts and routing

`ProtocolAdapter` exposes explicit state loading followed by state-parameterized `simulateBuy`,
`simulateSell`, and `valuePositionForExit` calls. Simulation methods receive the already-loaded state
and may not fetch a second hidden state. An `ExecutionRouter` resolves exactly one adapter by
`ProtocolId`; unknown protocols and duplicate registrations are typed failures and never fall back.

Phase 1's `ExecutionQuote` and `SimulatedExecution` contracts are refined rather than replaced. The
Phase 3 quote adds the market-state fingerprint and normalization version required for evidence-bound
replay.

## Reference adapter

`ReferenceProtocolAdapter` is marked **REFERENCE / TEST ONLY — NOT A PRODUCTION PROTOCOL** and is
registered only for `REFERENCE_TEST_ONLY`. It implements a constant-price fixture with exact integer
math and deterministic buy/sell fee basis points.

For BUY, the request is total Paper SOL leaving the account. The adapter calculates the included fee,
uses the remaining trade amount for token conversion, and returns the original total as `actualInput`.
Persistence records the fee breakdown but debits the total only once. It does not partially consume a
request.

For SELL valuation, the adapter calculates the whole-position gross output, deducts the configured
sell fee, and returns the executable net Paper SOL. An optional fixture mark value exists only to prove
that portfolio equity does not use display value.

## Market-state evidence and fingerprinting

`market_state_evidence` stores protocol, market, observation time, nullable chain slot/block context,
adapter version, normalization version, normalized JSONB, bounded optional raw JSONB, and a SHA-256
fingerprint. Raw evidence is capped at 64 KiB in the application service.

The fingerprint hashes a UTF-8 canonical JSON envelope containing identity, observation context,
adapter/normalization versions, and normalized state. Object keys are recursively sorted, array order
is preserved, and big integers are represented as explicit decimal strings. Unstable JavaScript object
insertion order therefore cannot change the hash.

`order_market_state_evidence` links the BUY decision to its execution state and to every existing
position's exit-valuation state. Every Phase 3A fill has a non-null application-enforced evidence
reference, protocol, adapter version, total actual input, and normalized fee breakdown. Schema columns
remain nullable only so the forward migration remains compatible with pre-Phase-3 development fills.
Both evidence tables and fills are immutable.

## Replay

Recorded normalized evidence reconstructs the same explicit `MarketState`. Passing the same request
and state to the same adapter version produces exact equality for input, output, fee breakdown,
protocol/market identity, and fingerprint. Simulation uses no random values, local clock, or hidden
network request.

## Executable portfolio valuation

Immediately before a BUY, every open position is locked and valued through the adapter for its own
protocol and market. The service sums net, whole-position executable Paper SOL values and current cash.
Cost basis, displayed mark value, cached P&L, and last-known values are not valuation inputs. Failure to
value any position rejects and rolls back the BUY.

The round's snapshotted basis-point ratio is applied with integer floor rounding:

```text
portfolio equity = current cash + sum(executable full-exit values)
max new buy = floor(portfolio equity * snapshotted ratio)
effective maximum = min(max new buy, current cash)
```

Existing exposure does not reduce the new-buy cap.

## Transaction and lock boundary

`executePaperBuy` performs one PostgreSQL transaction. Its lock order is:

1. claim/lock the `(operation class, idempotency key)` record;
2. lock the hourly round `FOR SHARE`, excluding a concurrent state transition;
3. lock the competition account `FOR UPDATE`, serializing cash, equity, slots, and positions;
4. lock all open positions in stable ID order.

Within that boundary it validates `OPEN`, enforces `[starts_at, ends_at_exclusive)`, loads and records
market states, values every position, applies the 20% and cash limits, checks token capacity, simulates
and validates the execution, then writes the order, evidence links, fill, position, slot, balance,
journal, and completed idempotency result.

The first slot is inserted only after a valid non-zero fill has been persisted. Account locking makes
two new-token attempts for a final slot mutually exclusive. It also forces a concurrent second BUY to
re-read cash and revalue the post-first-trade portfolio before applying the ratio.

## Idempotency and failure behavior

The operation class is `AUTHORITATIVE_PAPER_BUY`. The request fingerprint includes account, market,
requested total Paper SOL, and authoritative server timestamp. Same-key/same-request retries
reconstruct the original fill result. Same-key/different-request calls return `IDEMPOTENCY_CONFLICT`.

Failures roll back the claim and every financial/evidence row. Market-state or valuation outages are
therefore safely retryable with the same key. Product errors are stable typed codes and raw database
errors are not exposed as rule decisions.

## Accounting

BUY cost basis is the authoritative total Paper SOL input, including buy fees. The journal exchanges
that exact amount from `CASH` to `POSITION_COST`. Token inventory remains in the position/fill records
and is not posted as invented SOL value. Existing reconciliation continues to prove cash, position
cost, fills, starting capital, realized P&L, fees, and balanced journals.

## Remaining work before a real protocol

Phase 3B should harden the server-side market-state source abstraction and add persisted replay loading
plus operational adapter enable/disable controls. Phase 4 must then select an approved first Solana
venue, implement and independently validate its on-chain state decoding and exact protocol math,
define freshness/migration behavior, and add recorded chain fixtures. No reference-adapter output may
be treated as production pricing.

## Phase 3B: Pump.fun bonding-curve production adapter

Phase 3B selects Pump.fun as the first production venue and is intentionally limited to active,
pre-migration, SOL-paired Pump bonding curves. The adapter version is
`pump-bonding-curve-v1`; the normalized state version is `pump-bonding-curve-state-v1`. Completed
curves return `MARKET_MIGRATED`. PumpSwap/Raydium execution, token-quoted Pump V2 curves, real
transactions, and application-level SELL orchestration remain out of scope.

### Verified protocol sources

The implementation was checked on 2026-09-24 against:

- Pump's official current public IDL and integration documentation at
  `pump-fun/pump-public-docs` (program ID, discriminators, versioned account fields, PDAs, buy/sell
  instruction semantics, completion behavior, and Pump Fees accounts);
- official `@pump-fun/pump-sdk` version `2.0.0`, specifically `bondingCurve.ts`, `fees.ts`, and the
  version-aware decoders in `sdk.ts`;
- confirmed mainnet `getMultipleAccounts` snapshots for three active curves and one completed curve,
  captured at slots `450076965` and `450077014`.

The Pump program is `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`; the Pump Fees program is
`pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`. Bonding-curve identities are the PDA derived from
`["bonding-curve", mint]`. The source rejects an identity whose market address is not that PDA.

### RPC source and snapshot consistency

`PumpFunSolanaMarketStateSource` is separate from deterministic simulation. It uses one
`getMultipleAccounts` request to read the bonding curve, Pump global config, Pump fee config, and
token mint under one RPC context slot. Owners, discriminators, mint initialization, PDA identity,
account lengths, quote asset, fee tiers, and reserve validity are checked before normalization.
`SOLANA_RPC_URL` is server-only; `SOLANA_RPC_TIMEOUT_MS` defaults to 10 seconds; optional
`SOLANA_COMMITMENT` defaults to `confirmed`. Errors are reduced to typed codes and provider URLs are
never stored or logged. The evidence may contain bounded account bytes, but never the RPC URL.

Solana's contextual multi-account read provides a coherent bank snapshot for all required accounts.
It does not provide a block hash in this response, so evidence records the context slot and leaves the
block identifier null.

### Normalized state and layout

The replay state records exact decimal strings for virtual token/SOL reserves, real token/SOL
reserves, curve token supply, mint supply, the fee-evaluation supply, selected protocol and creator
fee basis points, selected tier threshold, configured creator rate, creator, completion and mode
flags, token program/decimals, all relevant account addresses, and source account version/length.
Legacy curve lengths are decoded with the same trailing zero/default semantics documented by the
official SDK. Financial values are converted to `bigint` before use.

Only SOL-like curve state (zero-key legacy SOL or wrapped-SOL representation) is accepted in this
adapter version. A non-SOL quote is rejected rather than incorrectly denominated as Paper SOL.

### Curve and fee math

Let `x` be virtual token reserves and `y` virtual SOL reserves. For a BUY whose request is the maximum
total Paper SOL leaving the account, including fees, the official exact-input helper first derives a
conservative curve budget:

```text
curve_budget = floor((maximum_total - 1) * 10_000 / (10_000 + total_fee_bps))
token_out = min(floor(curve_budget * x / (y + curve_budget)), real_token_reserves)
curve_input = floor(token_out * y / (x - token_out)) + 1
protocol_fee = ceil(curve_input * protocol_fee_bps / 10_000)
creator_fee = ceil(curve_input * creator_fee_bps / 10_000)
actual_total_input = curve_input + protocol_fee + creator_fee
```

The creator fee is omitted for legacy curves whose creator remains the zero key. The selected
creator rate can be replaced by the curve's configured rate only when the global configurable-fee
gate is enabled. BUY post-state subtracts token output from virtual/real token reserves and adds only
the curve input (not fees) to virtual/real SOL reserves.

For an exact-token SELL:

```text
gross_sol = floor(token_in * y / (x + token_in))
protocol_fee = ceil(gross_sol * protocol_fee_bps / 10_000)
creator_fee = ceil(gross_sol * creator_fee_bps / 10_000)
net_sol = gross_sol - protocol_fee - creator_fee
```

SELL post-state adds tokens to virtual/real token reserves and subtracts gross SOL from virtual/real
SOL reserves. Output above the physical real SOL reserve, non-positive output, and impossible reserve
results are rejected. `actualInput`/`actualOutput` retain Paperfund semantics: BUY input is total SOL
including fees and net token output; SELL input is exact tokens and output is net SOL. Fees are
reported separately for audit but are never debited twice.

Current Pump Fees selects a dynamic tier from market capitalization, not an old hard-coded flat
percentage. Market cap is integer `virtual_sol * supply / virtual_token`; non-Mayhem curves use the
protocol's one-billion-token base-unit supply constant while Mayhem curves use the live mint supply.
Each protocol/creator fee is ceiling-rounded independently, matching the official SDK.

### Evidence, replay, fixtures, and limitations

Market evidence reuses Phase 3A canonical JSON and SHA-256 fingerprinting. A quote is bound to the
supplied fingerprint and records deterministic post-trade reserves and derived price-impact audit
data. Full-exit valuation calls the exact same SELL math, so portfolio equity reflects executable net
SOL rather than cost basis or a chart mark.

Recorded fixtures in `packages/protocols/test/fixtures` contain stable mint/curve identities,
normalized replay state, curve account bytes, slots, capture date, and source notes for an early
curve, a more developed curve, a normal active curve, and a completed curve. Golden BUY/SELL values
were cross-checked from the official SDK equations rather than generated at test runtime by the
adapter. Ordinary tests are offline; a read-only live smoke test runs only when `SOLANA_RPC_URL` is
set and never constructs or submits a transaction.

Known limitations: freshness thresholds remain product-policy TBD; the source records but does not
invent such a threshold. The live smoke fixture can naturally graduate later and should then be
replaced with a newly recorded active identity. Token-2022 transfer-fee tokens are not given an
invented transfer model; Pump's current curve output custody transfer is assumed to match the
program's supported mint configuration, and future token-extension-specific behavior requires a
separate verified adapter revision.
