# Creator-fee reward accounting (Phase 5A)

Phase 5A is the authoritative funding-accounting layer. It records verified creator-fee revenue,
freezes exact hourly and daily prize-pool amounts, and maintains the player-owned Reward Buffer. It
does not allocate winners, sign transactions, hold payout keys, or transfer SOL.

## Fee events and attribution

`creator_fee_events` stores a bounded normalized record for each discovered chain event:
transaction signature, instruction/event index, slot, authoritative event time, exact lamports,
source program, optional token/project identity, observation time, verification status, and bounded
metadata. The unique pair `(transaction_signature, event_index)` is the authoritative idempotency
boundary. A verified event's chain identity, time, amount, source, and verification state are
database-immutable.

Only `VERIFIED` events in `ATTRIBUTED` state are eligible. Rejected, malformed, unknown,
estimated, client-supplied, duplicate, and unattributed events never fund rewards. Attribution uses
the authoritative event time and the hourly round's half-open `[start, end)` window. Discovery and
database insertion time are irrelevant. The daily destination is the UTC day containing the
hourly round start.

The repository supplies a `CreatorFeeSource` boundary and deterministic
`FixtureCreatorFeeSource`. No live Pump/PumpSwap watcher is implemented: current creator-fee event
decoding, finality, and reorg rules were not verified to the required standard without expanding
this phase. Production must not substitute an estimated or guessed watcher.

## Grace, freeze, and late events

Each hourly round snapshots its reward-finalization grace period (default 60 seconds). Trading in the
next round is independent. Reward finalization is rejected until
`ends_at_exclusive + grace <= now`.

Finalization atomically locks the hour and Reward Buffer, totals eligible events, computes all
allocations, writes the hourly snapshot, daily contribution, platform amount, buffer movements, and
marks source events counted. Once the hourly pool exists it is immutable and retries return the same
result.

A verified event discovered after freeze is stored as `LATE_AFTER_FREEZE` with one
`late_fee_reconciliations` row. It does not mutate the frozen pool. The remedy remains an explicit
future policy decision.

## Exact splits

All amounts use PostgreSQL `bigint` and TypeScript `bigint`.

- NORMAL: 63% natural hourly, 27% daily, 10% platform.
- BUFFER_ACCUMULATION: 58% natural hourly, 5% explicit buffer, 27% daily, 10% platform.

Largest-remainder allocation assigns unavoidable one-lamport dust by fractional remainder, with tie
priority hourly, daily, buffer, then platform. The 5% contribution is deducted from hourly capital;
it is not extra. NORMAL is the configured default.

## Baseline and dynamic smoothing

The baseline is the floored arithmetic mean of the previous full configured window of completed,
frozen natural hourly allocations, ordered by authoritative round start. The default window is 12.
The current hour is excluded. With fewer than 12 completed hours, smoothing is inactive and the
natural hourly allocation is the final hourly prize; an explicit accumulation contribution may
still enter the buffer.

With the default `lambdaBps = 6000`:

```text
target = floor(((10000 - lambdaBps) * baseline + lambdaBps * naturalHourly) / 10000)
```

The same-hour order is fixed: split, add explicit contribution, compute baseline, then smooth using
the updated buffer. A strong hour deposits `naturalHourly - target`. A weak hour withdraws at most
`min(target - naturalHourly, availableBuffer)`. There is no debt and the buffer cannot be negative.

Every non-zero movement is immutable and records its hour, reason, signed amount, starting balance,
and ending balance. Reasons are `EXPLICIT_ACCUMULATION`, `DYNAMIC_EXCESS_DEPOSIT`, and
`WEAK_HOUR_SUPPORT`. A locked `reward_buffer_state` row is only the materialized current balance;
the movements explain it.

## Hourly, daily, and platform persistence

`hourly_reward_pools` is one immutable configuration-and-calculation snapshot per hour. It includes
all inputs, split rates, baseline inputs, lambda, grace, buffer balances/movements, platform
allocation, daily allocation, target, and final hourly prize.

`daily_reward_contributions` stores exactly one immutable contribution per hourly pool.
`daily_reward_pools.accumulated_lamports` is transactionally recomputed from those contributions
and protected by a deferred database constraint, so the materialized total cannot silently diverge.

Platform allocation is persisted in the hourly snapshot and is never mixed with Reward Buffer
capital.

For every frozen hour the database and service enforce:

```text
creator fees + starting buffer
= final hourly prize + daily allocation + platform allocation + ending buffer
```

## Read API

All financial values serialize as exact decimal strings.

- `GET /api/v1/rewards/hourly/current`
- `GET /api/v1/rewards/hourly/:roundId`
- `GET /api/v1/rewards/hourly/:roundId/reconciliation`
- `GET /api/v1/rewards/daily/current`

An open/unfrozen hour is `PROVISIONAL` and reports verified fees observed so far plus provisional
natural-hourly and daily allocations. Dynamic smoothing is explicitly not final. A frozen hourly
response returns the immutable snapshot. The reconciliation response adds counted events, baseline
inputs, buffer movements, and an explicit conservation check.

## Worker and configuration

The worker continues trading lifecycle processing and separately finalizes every ended hour whose
snapshotted grace has elapsed. PostgreSQL advisory locks, row locks, unique constraints, and a single
transaction make concurrent workers and retries idempotent.

Environment keys:

- `REWARD_ALLOCATION_MODE=NORMAL`
- `REWARD_BASELINE_WINDOW=12`
- `REWARD_LAMBDA_BPS=6000`
- `REWARD_FINALIZATION_GRACE_SECONDS=60`

Mode activation is configuration only. No reserve-target or launch-policy auto activation exists.

## Not implemented

Phase 5A deliberately excludes live Pump/PumpSwap fee decoding, chain finality/reorg policy, automatic
post-freeze remedies, winner allocation, payout custody/signing/broadcast, real SOL transfers,
reserve-policy automation, admin UI, and additional protocols.
