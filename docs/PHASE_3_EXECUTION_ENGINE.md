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
