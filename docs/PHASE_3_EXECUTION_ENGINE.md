# Phase 3: Deterministic Execution, Authoritative Trading, and Hourly Settlement

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

## Phase 3C: Authoritative SELL and hourly forced settlement

### Authoritative SELL lifecycle

`executePaperSell` accepts an exact positive token base-unit quantity. Before opening its financial
transaction it resolves the market identity, loads one explicit authoritative state, creates its
fingerprint, and simulates the SELL. The transaction then claims idempotency, locks the round against
a state transition, locks the account and canonical position, revalidates inventory and round
authority, and atomically persists the completed order, `SELL_EXECUTION` evidence link, immutable
fill, position mutation, cash/P&L mutation, balanced journal, and completed idempotency result.

Normal SELL requires persisted round state `OPEN` and an authoritative server timestamp in the exact
`[starts_at, ends_at_exclusive)` interval. At the exclusive cutoff it rejects. Clients never supply
execution output, fees, price, cost basis, or P&L.

SELL `actualInput` is the exact token quantity removed. `actualOutput` and
`actual_output_lamports` are the exact net Paper SOL credited after fees. `quote_lamports` retains
gross proceeds for the existing Phase 2 ledger model, while the fee breakdown and fee total remain
explicit audit data. Cash is credited only with net proceeds, so fees are not deducted twice.

### Partial/full accounting and slots

For a partial SELL, removed cost basis is
`floor(existing basis * sold quantity / quantity before)`. Remaining quantity and basis are exact
integer subtraction; fill and account realized P&L equal net proceeds minus removed basis. A full
SELL removes every remaining basis unit, closes the existing position row, and cannot leave basis
dust. Rebuying reopens that same canonical position identity.

The journal debits net `CASH` and explicit `TRADING_FEES`, credits removed `POSITION_COST`, and posts
the signed gross `TRADING_PNL` balancing amount. Token quantities remain fill/position inventory and
are never posted as invented SOL ledger value. A close never deletes `competition_token_slots`, so a
same-token rebuy remains eligible while an unseen sixth token remains blocked at 5/5.

### Idempotency, concurrency, and adapter control

Normal SELL uses `AUTHORITATIVE_PAPER_SELL`; forced SELL uses
`FORCED_HOURLY_SETTLEMENT_SELL`. Deterministic order/fill/execution IDs and canonical request hashes
make same-key/same-request retries return the original result and changed requests return
`IDEMPOTENCY_CONFLICT`. The account/position locks serialize concurrent inventory removal; two
75-unit sells against 100 units cannot both succeed.

`ExecutionRouter.setEnabled` is the minimal server-side safety switch. A disabled protocol rejects
new user BUY/SELL with `PROTOCOL_DISABLED`. `resolveForSettlement` deliberately permits installed
adapter code for risk-reducing forced liquidation, so operationally pausing exposure does not strand
positions. This is not an admin UI or persisted authorization system.

### Settlement state, ordering, and transaction boundaries

`settleHourlyRound` locks the round and, only at or after cutoff, performs the approved
`OPEN -> CLOSING -> SETTLING` transitions. Workers enumerate open positions in reproducible
protocol ID, market ID, token mint order. Each position is fully liquidated through the same
authoritative simulation/accounting implementation as user SELL, distinguished by order
`execution_context = FORCED_HOURLY_SETTLEMENT`.

The transaction unit is one forced position, not the entire round. Market-state acquisition and
simulation occur before the short financial transaction; the transaction revalidates round state,
account finalization, and locked current inventory before committing. This avoids holding critical
PostgreSQL locks during network access while retaining oversell/cutoff correctness. Successful
liquidations remain committed if another market fails. Deterministic per-position idempotency keys
make retries and concurrent workers observe one effective liquidation without duplicate cash,
fills, journals, or results.

If state is unavailable, invalid, or migrated, no price is invented. The affected position stays
open, the round stays `SETTLING`, and the returned typed failure is retryable. In particular,
Pump.fun `complete` curves return `MARKET_MIGRATED`; Phase 3C has no PumpSwap/Raydium fallback, so the
round cannot finalize until a supported migrated-market adapter exists or an explicitly approved
future recovery policy is implemented.

### Account/result/daily/round finalization

After an account has no open quantity, settlement requires the materialized cash, position cost,
fill quantity, starting capital, realized P&L/fees, and every journal to reconcile. It then writes
the one immutable hourly result using the canonical formula:

```text
hourly P&L = final settled CASH - snapshotted starting Paper SOL
```

Trade-level realized P&L is audit detail and is not summed to create the result. Negative, zero, and
positive signed lamports are preserved. The result contributes exactly once through
`daily_result_hourly_results` to the UTC day containing the round start. No-trade accounts receive a
zero result and increment the daily completed-round count. Zero-participant rounds also finalize.

Only when every participating account has a result and no open position remains does the worker set
`SETTLING -> FINALIZED`; it does not enter `PAYING`.

### Persisted evidence replay

`replayPersistedFill` is read-only. It loads the fill and immutable evidence, reconstructs the exact
normalized `MarketState`, verifies the SHA-256 fingerprint, resolves the recorded protocol and
adapter version, reruns BUY or SELL simulation, and compares exact input, output, and fee totals.
Fingerprint mismatch returns `EVIDENCE_CORRUPTED`; unavailable historical code returns
`ADAPTER_VERSION_UNAVAILABLE`; output mismatch returns `INVALID_EXECUTION_RESULT`.

Freshness thresholds remain explicitly TBD. Evidence continues to preserve observation timestamps
and chain slots without choosing an unapproved production threshold.

## Phase 3D: migrated Pump.fun market execution

### Verified migration destination and scope

Current SOL-paired Pump.fun bonding curves graduate to a canonical PumpSwap pool. The destination
program is `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`. The canonical pool has index `0`; its
creator seed is the Pump program PDA `['pool-authority', base_mint]`; and its address is the PumpSwap
PDA `['pool', u16_le(0), creator, base_mint, wrapped_SOL_mint]`. Phase 3D intentionally supports only
this SOL-paired path because it is the universe already admitted by the production bonding-curve
adapter. USDC/custom-pair curves and historical pre-PumpSwap Raydium migrations remain explicit
unsupported routes.

This behavior was verified on 2026-09-24 from Pump's official `pump-public-docs` PumpSwap README and
IDL, the official `@pump-fun/pump-swap-sdk` version `1.20.0` source, Pump's current fee documentation,
and read-only mainnet account captures. The current PumpSwap adapter is
`pump-swap-canonical-v1`; normalized replay state is `pump-swap-state-v1`.

### Migration resolution and position continuity

`PumpMigrationResolver` reads the original program-owned bonding-curve PDA. An active curve retains
its `PUMP_FUN` route. A completed curve deterministically resolves to the mint's canonical
`PUMP_SWAP` pool; no client destination is accepted and there is no fallback. Missing destinations,
unsupported quote paths, and invalid route/token identities are typed failures.

The persisted position keeps its original economic identity (hourly account + asset + Pump curve),
quantity, cost basis, and realized P&L. Migration does not create a second position or accounting
entry. At valuation or exit time, `ExecutionRouter.resolvePositionRoute` selects the current venue.
Orders, fills, and evidence for an exit use the destination pool/protocol while the evidence link
points back to the original position. Historical BUY records therefore remain `PUMP_FUN`; migrated
SELL records are `PUMP_SWAP`. No database migration was necessary.

### State decoding and validation

`PumpSwapSolanaMarketStateSource` reuses the server-only Solana JSON-RPC client. It validates the
PumpSwap pool/global owners and discriminators, Pump Fees owner/layout, canonical pool PDA/index and
creator linkage, expected base mint and wrapped-SOL quote, initialized base mint, supported SPL Token
or Token-2022 base program, legacy SPL wrapped-SOL program, vault mint/authority identities, positive
physical reserves, effective quote reserves, fee tier ordering, and fee bounds. Missing appended pool
fields use the official zero/false legacy defaults.

The first contextual read loads pool, global config, fee config, and mint. After the pool identifies
its vaults, a second contextual read loads both vaults together. Evidence records both context slots
and uses the reserve read's slot. Replay state includes raw/effective/virtual quote reserves, base
reserves, vaults/mints/programs, selected fee tier and rates, pool flags and lengths, observation time,
adapter version, and the existing SHA-256 fingerprint.

### Constant-product math, fees, and rounding

All authoritative values use `bigint`. Pricing uses `effective_quote = raw_quote_vault +
virtual_quote_reserves`; the base side uses the raw base vault. For an exact-base BUY:

```text
internal_quote = ceil(effective_quote * base_out / (base_reserve - base_out))
fee_component = ceil(internal_quote * component_bps / 10_000)
total_quote = internal_quote + LP fee + protocol fee + creator fee
```

For Paperfund's maximum-total-input BUY, the official exact-quote helper first removes aggregate fee
basis points, corrects independent ceiling-fee excess, subtracts one unit before constant-product
output division, and then recomputes the exact quote required for that integer token output. Thus
Paperfund debits the exact amount a real exact-output PumpSwap instruction requires, never more than
the requested budget.

For an exact-token SELL:

```text
gross_quote = floor(effective_quote * base_in / (base_reserve + base_in))
fee_component = ceil(gross_quote * component_bps / 10_000)
net_quote = gross_quote - LP fee - protocol fee - creator fee
```

LP fees remain in the quote vault; protocol and applicable creator fees leave it. Creator fees apply
only when `coin_creator` is nonzero. Canonical SOL pools select their on-chain dynamic tier by
`floor(effective_quote * supply / base_reserve)`; Mayhem uses the protocol fixed supply. A permitted
nonzero per-pool creator rate replaces only the tier creator rate. No bonding-curve fee is reused and
fees are never charged twice.

Full-position valuation calls the same exact-base SELL path. Larger buys and sells demonstrably
receive worse average execution, and full-exit value differs from spot value.

### User SELL, portfolio valuation, settlement, and controls

Normal partial/full SELL, pre-BUY portfolio valuation, and hourly forced settlement all resolve the
position route immediately before state acquisition. The server idempotently registers the verified destination market from the origin market's existing
base/quote asset identity, then validates that identity before execution; a conflicting registration
stops safely. Partial basis removal and final basis cleanup
are unchanged. Settlement can use installed destination code when new trading is administratively
disabled, preserving the Phase 3C risk-reduction rule. Unavailable routing leaves the position open
and round `SETTLING`; completed per-position liquidations remain idempotently committed.

Recorded offline fixtures cover a normal, deep, and shallow canonical pool plus each linked completed
Pump curve, including public addresses, reserves, virtual quote state, slot, capture time, fee rates,
and curve bytes. Golden values are independent constants calculated from the official SDK equations.
An optional read-only live smoke runs when `SOLANA_RPC_URL` is configured; ordinary tests remain
offline and never sign or submit transactions.

Known limitations: only SOL-paired canonical PumpSwap pools are supported. Historical Raydium routes,
USDC/custom quote pairs, and token extensions that impose transfer-side economics beyond the current
program quote helpers require separately verified adapter revisions. Market-state freshness policy
remains product-policy TBD; Phase 3D records observation context without inventing a threshold.
