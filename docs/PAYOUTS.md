# Winner payout accounting and secure execution

> Implementation/procedure reference. See README.md and docs/publication/STATUS.md for current status: PAPER trading is active; financial STOP and historical REVIEW holds remain, and live daily payouts are not qualified. This document is not execution authorization.

Phase 5C calculates and persists exact winner obligations. Phase 5D adds an operator-controlled,
server-only Solana execution pipeline. Real payout execution is disabled by default, requires an
explicit approval, and reports **Paid** only after finalized on-chain reconciliation succeeds.

## Authoritative inputs

An hourly plan requires both a `FINALIZED` hourly round/result set and a `FROZEN` or `FINAL` hourly
reward pool. A daily plan requires a `FINALIZED` daily competition/result set and a `FROZEN` or
`FINAL` daily reward pool. Provisional rankings and open reward pools are never inputs.

The worker freezes a daily reward pool only after every hourly round belonging to that UTC day is
finalized and has a frozen reward pool. Trading in the next hour/day does not wait for payout-plan
generation.

## Versioned curves

`hourly-top10-v1` uses exact ppm weights:

| Rank | Weight | Rank | Weight |
| ---: | -----: | ---: | -----: |
|    1 | 25.00% |    6 |  6.67% |
|    2 | 19.20% |    7 |  5.12% |
|    3 | 14.74% |    8 |  3.93% |
|    4 | 11.32% |    9 |  3.02% |
|    5 |  8.69% |   10 |  2.31% |

`daily-top25-v1` uses: 15.000%, 12.792%, 10.909%, 9.303%, 7.934%, 6.766%, 5.770%,
4.921%, 4.196%, 3.579%, 3.052%, 2.603%, 2.220%, 1.893%, 1.614%, 1.377%, 1.174%,
1.001%, 0.854%, 0.728%, 0.621%, 0.530%, 0.452%, 0.385%, and 0.326% for ranks 1–25.
Both curves total exactly 1,000,000 ppm.

Historical plans snapshot the complete curve and retain its version, so future configuration changes
cannot silently change past obligations.

## Ranking, ties, and underfilled fields

Ranking remains competition ranking: `1, 2, 2, 4`. The tie policy version is
`combined-funded-ordinals-v1`.

Each tie group occupies ordinal positions beginning at its competitive rank. Funded ordinal buckets
are combined, then divided equally among every tied user. For a three-way tie occupying ordinals
4–6, buckets 4, 5, and 6 are pooled. For a tie occupying ordinals 10–11 in an hourly plan, only
bucket 10 contributes, but both tied users share it. A group wholly below the cutoff receives no
allocation. This creates no extra prize capital and never chooses an arbitrary competitive winner.

If the field has fewer than the nominal winner count, the weights for occupied ordinals are
renormalized to the complete prize pool before tie pooling. Negative, zero, and positive scores are
all eligible when they fall within the funded field.

## Exact integer math and dust

All money is integer lamports and all calculations use `bigint`.

For each funded ordinal, the service records the curve weight, floor allocation, division remainder,
and final bucket. Remaining lamports are assigned by largest remainder; equal remainders fall back to
ordinal ascending. This completes rank-bucket allocation exactly.

After funded buckets are pooled for a tie, integer division produces an equal floor. Any remaining
lamports are assigned by stable user ID ascending. This order exists only to place indivisible dust:
it does not break the tie, change competitive rank, change display order, or imply superiority.

For every plan:

```text
sum(rank bucket final allocations)
= sum(user allocations)
= frozen prize pool
```

## Persistence and lifecycle

Migration `0005_past_zaran.sql` adds:

- `payout_plans`: source identity, versions, source/config snapshots, counts, lifecycle timestamps,
  exact pool/allocated totals, and conservation status;
- `payout_rank_buckets`: the exact floor, remainder basis, and final amount for each funded ordinal;
- `payout_allocations`: user, competition rank, tie range/size, funded ordinal count, exact amount,
  dust adjustment, and calculation explanation.

The lifecycle is `CALCULATED → FROZEN → VALIDATED → APPROVED → SIGNED → BROADCAST → VERIFIED`.
`FAILED_RETRYABLE`, `FAILED_FINAL`, and `RECONCILIATION_REQUIRED` record exceptional paths without
silently skipping a stage. Financial fields, allocation details, approvals, allocation-to-batch
mappings, and broadcast attempts are immutable. Operator approval records its source, identifier,
time, and a SHA-256 hash of the approved plan snapshot.

One plan is authoritative per hourly round/curve version or daily competition/curve version.
Transaction-scoped PostgreSQL advisory locks and unique constraints make retries and simultaneous
workers converge on the same plan.

## Validation and audit

The validator independently checks finalized source state, frozen reward state, known curve and tie
versions, participant/winner counts, source ranks and tie groups, exact rank buckets, user
allocations, duplicates, nonnegative amounts, and conservation. A changed authoritative source is
reported as invalid; normal generation never rewrites the frozen plan. Reconciliation or adjustment
for a changed upstream authority requires a future explicit workflow.

The audit model includes the frozen prize pool, source leaderboard snapshot, curve snapshot, exact
rank buckets, tie ranges and funded ordinals, equal split, dust adjustment, final user allocations,
and conservation proof.

## Public reads

- `GET /api/v1/rewards/hourly/:roundId/winners`
- `GET /api/v1/rewards/daily/:dateOrCompetitionId/winners`
- `GET /api/v1/payout-plans/:id`
- `GET /api/v1/rewards/me` (authenticated)

Public responses expose wallet display identity but omit internal user/result IDs and internal dust
ordering. Exact lamports are JSON strings. Current-user responses distinguish pending allocation,
approved, processing, paid, and failed/review. Only `VERIFIED` is presented as paid.

## Secure operator workflow

Payouts use the authenticated user's canonical Solana wallet snapshot from the approved allocation.
Destinations and treasury are parsed as Solana public keys before preparation. A deterministic batch
contains at most `PAYOUT_MAX_RECIPIENTS_PER_BATCH` recipients (default 8), with each allocation
constrained to exactly one batch. Its intent hash commits to intent version, plan, batch index,
network, treasury, and ordered allocation/destination/lamport tuples.

The RPC boundary gets a recent blockhash, estimates the message fee, checks the treasury can cover
the complete payout plus fees, submits signed bytes, reads signature status, and fetches the
finalized parsed transaction. Fees are platform operating costs and never reduce allocations.
Prepared intent is persisted before signing. The signer receives only serialized transactions built
from that frozen intent; signer secrets are neither persisted nor logged.

Approval and preview:

```text
npm run payout:approve -- <plan-id> <operator-identifier>
npm run payout:execute -- <plan-id>
npm run payout:status -- <plan-id>
npm run payout:status -- <plan-id> --reconcile
```

Execution is dry-run by default: it validates state, checks RPC network and treasury, builds batches,
estimates fees, and prints intent hashes without signing or broadcasting. Live execution requires
`--live`, `PAYOUT_EXECUTION_ENABLED=true`, a configured treasury, and an enabled signer.
`PAYOUT_NETWORK=mainnet-beta` additionally requires `PAYOUT_MAINNET_CONFIRM=true`; RPC genesis must
match the explicitly configured network. A development local keypair may be supplied only through
server-side `PAYOUT_SIGNER_SECRET_KEY` JSON and must match the treasury. The signer interface can be
replaced by an HSM, hardware, multisig, or remote signer.

If submission response is lost, the known signature is reconciled before any resend. The same signed
bytes have the same signature. A missing transaction is eligible for `--live --retry` only after its
last valid block height passes and history still contains no signature; the service then rebuilds
from the same immutable intent. Verified batches are never rebuilt or resent. Multi-batch execution
remains partial until every batch verifies.

The status command reports the persisted plan, execution, every batch, signatures, attempts,
confirmation slots, totals, and failures. `--reconcile` performs the same finalized-chain comparison
used by execution; it does not approve, sign, or broadcast. Operational preparation, supervision,
backup, and incident procedures are in [the operations runbook](./OPERATIONS.md).

`VERIFIED` requires `finalized` signature status, a successful transaction, and exact comparison of
on-chain System Program transfers with persisted treasury, ordered recipients, and lamports. A
mismatch becomes `RECONCILIATION_REQUIRED`, never paid. A returned send signature is only an
identifier; completion uses signature status plus the finalized transaction rather than the
deprecated confirmation RPC.

## Zero-participant carry-forward

A finalized hourly or daily player reward pool with zero eligible participants creates no winner and
no payout plan. Its complete player-designated amount moves atomically into Reward Buffer with an
immutable `ZERO_PARTICIPANT_CARRY_FORWARD` movement and source-unique outcome. Nothing is burned or
routed to platform accounting, and retries cannot apply the carry twice.

## Configuration

- `PAYOUT_EXECUTION_ENABLED=false`: fail-closed live execution switch.
- `PAYOUT_NETWORK=localnet`: explicit `localnet`, `devnet`, or `mainnet-beta` selection.
- `PAYOUT_MAINNET_CONFIRM=false`: independent mainnet acknowledgement.
- `PAYOUT_TREASURY_PUBLIC_KEY`: public fee-payer/source address only.
- `PAYOUT_SIGNER_TYPE=DISABLED`: `DISABLED` or development-only `LOCAL_KEYPAIR`.
- `PAYOUT_SIGNER_SECRET_KEY`: server-only 64-byte JSON secret; never persisted or printed.
- `PAYOUT_MAX_RECIPIENTS_PER_BATCH=8`: conservative retry-isolated batching limit.
- `PAYOUT_MAINNET_MAX_PLAN_LAMPORTS=100000000`: reviewed fail-closed ceiling for one mainnet plan;
  dry-run refuses totals above it before signing.

## Not implemented

No multisig UI, admin dashboard, KYC/tax workflow, treasury auto-funding/sweeping, withdrawals,
arbitrary payout editing, token conversion, or automatic mainnet execution is included. Devnet is
supported by configuration, but live devnet smoke is optional and not part of deterministic tests.
