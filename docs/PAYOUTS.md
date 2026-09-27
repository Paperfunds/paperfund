# Shadow winner payout accounting

Phase 5C calculates and persists exact winner obligations. It is accounting only: no payout wallet,
private key, transaction instruction, signature, broadcast, withdrawal, or on-chain transfer exists.
The UI must say **Reward allocation** or **Pending payout**, never **Paid**.

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

The shadow lifecycle is `CALCULATED → FROZEN → VALIDATED → APPROVED`. Generation currently reaches
`VALIDATED`; `APPROVED` is reserved for a later operational workflow. `SIGNED`, `BROADCAST`, and
`VERIFIED` are deliberately not implemented. Financial fields and allocation details are immutable,
and lifecycle state cannot move backward.

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
ordering. Exact lamports are JSON strings. The current-user response labels amounts `PENDING` unless
a future approval/payment workflow establishes a stronger state.

## Not implemented

No real-SOL transaction construction, custody, payout address snapshot, private keys, signing,
multisig, approval dashboard, broadcast, confirmation, treasury deposit, withdrawal UI, tax/KYC, or
reconciliation adjustment is included.

A positive frozen prize pool with zero participants cannot satisfy both “pay only participants” and
exact conservation. Generation therefore fails closed for that case. No recipient, carry-forward,
or treasury fallback has been invented; it requires a future explicit product policy.
