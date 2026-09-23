# `@paperfund/core`

This package owns framework-independent Paperfund domain configuration, exact numeric primitives, identifiers, state types, UTC boundary utilities, and domain data shapes.

- Authoritative money uses branded `bigint` base units.
- Authoritative rates use exact integer basis points or parts-per-million.
- Product configuration is centralized and validated when the package loads.
- UTC intervals use exclusive end boundaries: `[start, end)`.

Database access, API behavior, execution-price calculation, Solana integration, transaction construction, and payout persistence do not belong here at this phase. Product rules remain canonical in the repository-root `PROJECT_CONTEXT.md`.

## Current pure rules

- A new hourly account always starts from the configured Paper SOL balance with no consumed token slots; previous-hour state is not accepted as input.
- The maximum-buy ratio applies to each **new buy order**, not to total exposure in the target token. Existing exposure or later appreciation does not reduce the next order's ratio cap.
- A token slot is keyed by canonical mint and is consumed only when a caller records the first successful, non-zero buy fill. Failed, rejected, and zero-fill attempts do not consume slots, and selling does not free one during the round.
- Slot state resets only by initializing the next hourly competition account.
- Pre-buy validation and successful execution application are deliberately separate. Application consumes authoritative fills and never recalculates price, slippage, protocol fees, or the 20% request limit.
- An execution's `actualInput` is the total asset amount leaving the account, including same-asset fees. Its `actualOutput` is the net asset amount entering the account after output-asset fees. The quote fee list is an audit breakdown already reflected in those values and is never posted twice.
- Position cost basis is exact Paper SOL actually spent. A partial sell removes `floor(cost basis × sold quantity / quantity before sell)`; indivisible remainder remains with the open position, and a final sell clears all remaining basis.
- Canonical position identity is account + hourly round + token mint + market + protocol. The same mint may therefore have separate positions in separate markets; application never nets them across markets.
- Ledger amounts are signed from the account's perspective: positive enters the account and negative leaves it. IDs and timestamps are supplied by the caller.
- Closing a position never frees its mint's token slot. The slot stays consumed until the hourly account resets.
- Hourly round states advance one step at a time: `SCHEDULED → OPEN → CLOSING → SETTLING → FINALIZED → PAYING → PAID`. Opening is allowed from the inclusive start until the exclusive end; normal closing is allowed only at or after the end.
- Trading authority uses the caller-supplied UTC instant and the half-open `[start, end)` window. State must also be `OPEN`; no helper reads the wall clock.
- Forced settlement receives one authoritative full-close SELL execution per canonical open position. It sorts by protocol, market, then mint and reuses normal SELL accounting with forced-settlement ledger event types.
- Final hourly P&L is calculated from final settled Paper SOL minus the configured starting balance, not from accumulated trade-level P&L.
- Market execution calculation remains outside this phase. The financial ledger contains no fake zero-value round-finalization posting; finalization is represented by the finalized round and `HourlyResult`.
- Pure settlement rejects a round that is not `SETTLING`, and its successful output is already `FINALIZED`, preventing obvious in-memory double application. Durable idempotency and retry coordination remain responsibilities of the future persistence layer.
- A user's Daily Championship score is the exact signed sum of every unique finalized hourly P&L, including gains, losses, and zero results. The aggregate retains contributing hourly round IDs for duplicate detection.
- Daily UTC attribution uses the hourly round's start time in the Daily Championship's `[start, end)` window. Settlement or payout completion time never changes attribution; a 23:00–00:00 round belongs to its start day.
- Hourly and daily leaderboards rank scores descending using competition ranks (`1, 2, 2, 4`). Equal scores remain explicit unresolved tie groups. User-ID ordering inside a tie is serialization-only and is **not a tie-breaker**.
- A tie group crossing the configured Top 10 or Top 25 boundary returns `UNRESOLVED_TIE_AT_WINNER_CUTOFF`; ties wholly inside or outside the winner area do not block provisional membership selection.
- Verified creator fees split in exact lamports. Normal Mode allocates 63% to the natural hourly reward, 27% to the daily pool, and 10% to platform. Buffer Accumulation Mode allocates 58% hourly, 5% explicitly to the Reward Buffer, 27% daily, and 10% platform. Largest-remainder rounding conserves every lamport.
- The dynamic hourly curve uses only the natural hourly allocation. It activates after a full configurable baseline window (12 completed prior hours by default), using the floor of their arithmetic mean; partial windows never activate smoothing.
- In Buffer Accumulation Mode, the explicit contribution enters the buffer before the dynamic curve may use it. Strong-hour excess can join that balance, weak-hour support is capped by it, and the Reward Buffer can never become negative.
- Each processed hour exactly conserves `creator fee + starting buffer = hourly prize + daily allocation + platform allocation + ending buffer`. Daily allocations accumulate directly and are never smoothed or supplemented by the Reward Buffer.
- Final payout allocation is exact in lamports for the configured Top 10 and Top 25 curves. Any tie among occupied winning ranks blocks payout because tie-breaking remains unresolved; a tie entirely outside the winners does not.
- Under-filled competitions renormalize the occupied rank weights so all prize funds go to actual winners. Division floors each allocation, then assigns all indivisible payout dust to rank 1.

These are pure deterministic domain rules, not concurrency controls. The application/persistence layer must eventually run validation, state transitions, settlement application, idempotency checks, and persistence within authoritative transaction or lock boundaries so concurrent work cannot act against stale state or settle twice.
