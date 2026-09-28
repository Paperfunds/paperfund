# Creator-fee ingestion and reward accounting (Phases 5A and 5E)

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

The repository supplies a `CreatorFeeSource` boundary, deterministic `FixtureCreatorFeeSource`, and
the read-only production `SolanaPumpCreatorFeeSource`. The production source scans only the explicitly
configured Paperfund token mint, then accepts an event only when its program, discriminator, matching
trade instruction, mint/pool, wrapped/native SOL quote, creator wallet, successful transaction, exact
fee, and destination-vault account semantics agree. It never estimates a fee from volume or a rate.

## Live Pump ecosystem source

Phase 5E verified the current official
[Pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json),
[PumpSwap IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_amm.json),
[creator-fee collection documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COLLECT_CREATOR_FEE.md),
and [creator-fee sharing documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md).

- Pump.fun bonding-curve trades run under `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`.
  `TradeEvent.creator_fee` is the exact lamport amount. The event mint and creator must match the
  configured funding identity and a current legacy or v2 buy/sell instruction in the same successful
  transaction. V2 verification additionally binds base mint, wrapped-SOL quote mint, quote token
  program, creator-vault PDA, and its associated quote-token account. Fees accrue there and may be
  collected later with `collect_creator_fee_v2`; collection is not counted as new revenue.
- PumpSwap trades run under `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`.
  `BuyEvent.coin_creator_fee` or `SellEvent.coin_creator_fee` is exact. Because the event names its
  pool rather than its base mint, the parser binds it to the same transaction's canonical PumpSwap
  trade instruction and verifies pool, configured base mint, wrapped-SOL quote mint, creator, and
  coin-creator vault accounts. `collect_coin_creator_fee` is a later claim and is not counted.

Current events expose cashback and holder-reward fields. Paperfund rejects events with non-zero
cashback or holder rewards because those amounts are not unambiguously creator-wallet revenue. A
shared creator configuration must still emit the exact configured creator and token identity; the
source otherwise fails closed.

The immutable chain identity is `(transaction signature, event log index)`. Anchor `Program data`
is decoded only while the expected program is active in the invocation log, then bound to the
matching compiled instruction. Real mainnet Pump and PumpSwap event payloads are checked into the
test suite as offline fixtures; tests never need the network.

## Observation, finality, and reconciliation

Discovery is not financial verification. `creator_fee_observations` records `OBSERVED`, `CONFIRMED`,
and `FINALIZED` lifecycle evidence. Only Solana `finalized` status promotes an event into the existing
canonical `creator_fee_events` table with `VERIFIED` status. The authoritative financial timestamp is
the transaction's chain `blockTime`, not RPC discovery time or the protocol event timestamp.

Pending signatures are rechecked on every ingestion tick. An on-chain error or three consecutive
history-aware status misses becomes `ROLLED_BACK` and never funds rewards. Recent finalized
observations are also re-audited against
signature status, refetched event evidence, and the linked canonical row. Any disappearance or
mismatch becomes `RECONCILIATION_REQUIRED` and creates an explicit open
`creator_fee_reconciliation_findings` row. Immutable reward history is not silently rewritten.

`creator_fee_ingestion_checkpoints` stores the source/network/funding identity, newest durable
signature and slot, finalized-chain slot, success time, and last categorized RPC error. The cursor is
advanced only after observations have been persisted. A crash before advancement safely replays the
same chain identities through database uniqueness.

## Operations and configuration

Live following is disabled by default and isolated from the round/reward/payout worker path. An RPC
failure records health detail and does not stop hourly lifecycle processing. Reads are serially
rate-limited, have bounded exponential retry/backoff, time out, and use a configurable page size.
No signer, secret key, transaction construction, send, claim, sweep, or trade operation exists in
this source.

Environment keys:

- `CREATOR_FEE_INGESTION_ENABLED=false`
- `CREATOR_FEE_SHADOW_MODE=true` (observe finality and health without canonical financial mutation)
- `CREATOR_FEE_NETWORK=mainnet-beta`
- `PAPERFUND_TOKEN_MINT` (required when enabled)
- `PAPERFUND_CREATOR_WALLET` (required when enabled)
- `CREATOR_FEE_PAGE_SIZE=50` (1–100)
- `CREATOR_FEE_RPC_MAX_ATTEMPTS=4`
- `CREATOR_FEE_RPC_MIN_INTERVAL_MS=75`

Operator commands:

```text
npm run creator-fees:status
npm run creator-fees:backfill -- <from-slot> <to-slot-exclusive> [max-transactions]
```

Backfill ranges are half-open, capped at 500,000 slots and 10,000 examined transactions, accept only
finalized evidence, do not move the live-follow cursor, and are idempotent. Status reports the durable
checkpoint, lag inputs, categorized error, and observation counts. Open reconciliation findings can
be inspected directly with the status data and database audit tables.

Migration `0008_operational_shadow_ingestion.sql` adds durable shadow-mode and cumulative operational
telemetry. Shadow finalizations retain verified observation evidence but deliberately leave
`canonical_creator_fee_event_id` empty; the evidence records the would-be hourly round and
`ATTRIBUTED`, `LATE_AFTER_FREEZE`, or `INELIGIBLE` result. Poll, candidate, verified, rejected, retry-error, and
maximum-lag metrics survive worker restarts. See [the operations runbook](./OPERATIONS.md) for rollout,
restart, outage, and promotion criteria.

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

## Known limitations

Only current Pump.fun bonding-curve and canonical PumpSwap trade events are supported. Raydium,
Meteora, other launchpads, fee claiming/sweeping, automatic post-freeze remedies, and an admin UI are
out of scope. A protocol IDL/event-layout upgrade fails closed until reviewed. Bounded historical
backfill depends on the configured RPC retaining the requested transaction history. A finalized
inconsistency is quarantined for operator reconciliation; it never automatically reverses a frozen
reward pool.
