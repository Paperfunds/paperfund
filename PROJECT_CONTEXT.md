# Paperfund: Canonical Product and Engineering Specification

**Document status:** Canonical specification with Phase 5E implementation record
**Product status:** Authoritative trading, live creator-fee ingestion, reward accounting, winner allocation, and controlled payout execution complete
**Authority:** This repository-root document is the source of truth for product and engineering decisions unless a later, explicitly approved change updates it.  
**Last updated:** 2026-09-28

## 1. Purpose and change policy

Paperfund is a free-to-enter, server-authoritative Solana paper-trading competition funded by verified creator-fee revenue. It is intended primarily as a browser extension or overlay on existing Solana trading terminals, supported by a website for leaderboards, history, prize pools, rules, payouts, and account views. It is not a full custom trading terminal and it does not execute real-money user trades.

Future work must read this document completely before making changes. Product rules must not be changed by implementation convenience. If a task conflicts with this document, work must stop and the conflict must be reported unless the task explicitly authorizes a specification change.

Terminology used in this document:

- **MUST / MUST NOT**: required behavior.
- **SHOULD / SHOULD NOT**: preferred behavior; deviations require a documented reason.
- **CONFIGURABLE**: the value or policy must be centralized, versioned, and changeable without scattering constants through the code. Rule changes normally apply only to future rounds.
- **TBD**: no product decision has been approved. Implementations must not invent one.
- **Paper SOL**: simulated competition accounting units denominated in SOL; not real SOL and not withdrawable.
- **Real SOL**: on-chain SOL used for competition rewards.

## 2. Product principles

1. **Execution realism is foundational.** Paper trades must model real market mechanics as accurately as practical. They must not fill at a chart price when real execution would incur price impact, slippage, protocol fees, creator fees, route effects, or bonding-curve/AMM mechanics.
2. **Determinism over artificial realism.** Execution is derived deterministically from authoritative recorded market state. Do not add random slippage or fake random delays.
3. **Server authority.** Clients request actions; the backend owns validation, balances, fills, positions, P&L, ranks, prize pools, token-slot use, settlement, and rewards.
4. **Auditability.** Every financial state transition and the market state behind every fill must be explainable and replayable.
5. **Clear simulation labeling.** The extension and website must clearly identify all paper trades and Paper SOL as simulated.
6. **Separation of concerns.** Competition rules, protocol execution math, terminal integrations, accounting, and payout signing are separate layers.
7. **Financial solvency.** Never promise or allocate funds that do not exist. Player reward money and Platform Treasury money must remain separate.
8. **Controlled delivery.** Build in small, verified phases rather than attempting the entire product at once.

When forced to choose between fast but financially fake behavior and slower, deterministic, realistic behavior, choose deterministic realistic behavior. The trust target is: a simulated result should be realistically close to the result of placing the same real-SOL trade under the same market conditions.

## 3. Competition model

### 3.1 Hourly competition

Each eligible competition account begins every hourly round with exactly **10 Paper SOL**. There are no top-ups during a round. Gains and losses do not carry into the next round; only the completed result is retained for history, statistics, and Daily Championship scoring.

During the open period, users trade supported Solana memecoin markets using the paper account. At the hourly cutoff:

1. The authoritative round state atomically transitions from `OPEN` to `CLOSING`; no new order may enter the round after this transition.
2. Open positions are force-sold through the same realistic execution engine used for normal sells.
3. Price impact, slippage, and all applicable fees are applied.
4. All balances are converted to Paper SOL.
5. Final settled balance and hourly P&L are stored.
6. The hourly leaderboard is finalized.
7. A configurable reward-finalization grace period allows late-discovered creator-fee events to be attributed by their authoritative on-chain event time/slot.
8. After the grace period, reward accounting and the hourly prize pool are frozen and allocated to the Top 10.
9. Payout processing begins.
10. The next hourly round starts immediately at the cutoff with a fresh 10 Paper SOL account; it does not wait for prior-round settlement or reward finalization.

Hourly P&L is:

```text
hourly_pnl = final_settled_paper_sol - 10 Paper SOL
```

Examples: a final balance of 14.2 produces +4.2 Paper SOL P&L; 3.7 produces -6.3 Paper SOL P&L.

If a user exhausts their Paper SOL balance, they wait for the next hourly reset. Live ranks and portfolio values are provisional until force settlement completes.

### 3.2 Daily Championship

The Daily Championship runs over one UTC calendar day. An hourly round belongs to the UTC Daily Championship whose `[00:00:00, 24:00:00)` window contains the hourly round's authoritative **start time**. Settlement completion time, reward finalization time, payout time, indexer discovery time, and the user's local timezone do not affect this attribution.

Examples:

- the hourly round from `2026-09-23T23:00:00Z` to `2026-09-24T00:00:00Z` belongs to the `2026-09-23` UTC Daily Championship, even if settlement or later processing completes after midnight;
- the hourly round from `2026-09-24T00:00:00Z` to `2026-09-24T01:00:00Z` belongs to the `2026-09-24` UTC Daily Championship.

Every finalized hourly result from a round attributed to that UTC day contributes to the user's cumulative daily score. Positive, negative, and zero-P&L results all count, and every unique hourly round may be counted at most once for a user.

```text
daily_score = sum(all completed hourly P&L in the current UTC day)
```

The cumulative score remains exact Paper SOL P&L. There is no best-three-hours filter, positive-score floor, or loss protection. More activity creates more opportunity and more downside; that is intentional. The Top 25 are paid after the UTC day finalizes. There is no monthly cash competition in the current product scope.

### 3.3 Authoritative time model

All competition authority uses UTC. Frontends may display local time but must not use it to decide state.

- Hourly example: 15:00:00 UTC opens; 16:00:00 UTC closes.
- Daily period: 00:00:00 UTC opens; 23:59:59.999 UTC is the last active instant; 00:00:00 UTC on the next day finalizes the previous day.
- At an hourly close, the system rejects new orders, enters settlement, and opens the next round immediately according to persisted state-machine transitions. The completed round's reward accounting freezes and payouts begin only after its reward-finalization grace period ends.

Round behavior must not be derived only from wall-clock time. Persist transitions and use idempotent workers. An order may enter an hourly round only while the authoritative server-side round state is `OPEN`. Once the round atomically transitions from `OPEN` to `CLOSING`, no new order may enter that round. Browser timestamps are never authoritative. Order admission and the state transition must use transactional state/locking or an equivalent serializable mechanism so an order cannot race the cutoff. Any order transaction that does not authoritatively establish admission while the state is `OPEN` must be rejected from that round.

## 4. Trading rules

### 4.1 Starting balance

- Starting balance per hourly round: **10 Paper SOL** (**CONFIGURABLE and versioned**, with 10 as the launch value).
- No intra-round top-ups.
- Previous round balances never roll over.

### 4.2 Unique-token entry limit

- Launch limit: **5 unique token entries per hourly round** (**CONFIGURABLE and versioned**).
- A slot is consumed only after the first successful, non-zero buy fill for that token in the current round.
- Selling and rebuying the same token does not consume another slot.
- Failed, rejected, and zero-fill buy attempts do not consume a slot.
- Slot allocation must be transactional so simultaneous buys cannot exceed the limit.
- The UI must show usage, for example `Token slots: 3 / 5 used`.

### 4.3 Maximum buy rule

Immediately before each buy, the authoritative backend calculates:

```text
portfolio_equity_before_buy = Paper SOL cash
                            + current value of all token positions

max_buy_value = portfolio_equity_before_buy × 0.20
```

The launch maximum-buy ratio is **20%** (**CONFIGURABLE and versioned**). The valuation source used in pre-trade equity must be authoritative; its exact market-state freshness policy is **TBD**.

The rule applies only when buying. A valid position that later appreciates beyond 20% of portfolio equity is not force-reduced. Validation and balance mutation must be atomic or equivalently concurrency-safe so simultaneous orders cannot bypass the rule.

### 4.4 Accounts and authentication

- Preferred authentication: Solana wallet nonce signing.
- Never collect wallet private keys.
- V1 policy: one wallet equals one competition account.
- Users may operate multiple wallets/accounts.
- V1 has no aggressive Sybil restrictions, mandatory KYC, wallet-age rule, device fingerprint requirement, or token-holding requirement.
- Legal/compliance review may require future changes; such changes must be explicitly approved and versioned.

## 5. Execution and valuation

### 5.1 Realistic execution requirements

Paper trades must not automatically fill at a displayed chart price. Depending on protocol and route, quotes and fills may account for:

- bonding-curve state;
- AMM reserves and invariant math;
- pool state and quote asset;
- protocol and creator fees;
- trade direction and size;
- price impact and deterministic slippage implied by the market/route;
- token-specific mechanics;
- migration state;
- route composition.

Do not add random slippage or artificial random latency. Liquidity is an execution input, not a reason for arbitrary V1 minimum-liquidity bans. A large trade into a shallow curve or pool must receive the worse average execution that the real mechanics imply.

If market state is missing, stale beyond the approved policy, internally inconsistent, or unsupported by the relevant adapter, reject or defer the trade. Never invent a market price. The exact stale-data thresholds and defer/reject policy are **CONFIGURABLE/TBD**.

### 5.2 Mark value versus executable value

The product must distinguish clearly between:

- **mark/display value**, used for understandable live display; and
- **executable value**, the output realistically obtainable by simulating liquidation of a specific position against authoritative state.

Settlement, final ranking, and liquidation use simulated executable value. A displayed portfolio value must never be assumed fully realizable without price impact and fees. Interfaces should label which valuation is shown and explain meaningful differences.

### 5.3 Force settlement

At close, all open positions are sold through the same adapter and execution logic as user-initiated sells. Settlement applies actual simulated price impact, deterministic route effects, slippage, and fees, then records final Paper SOL.

Settlement must be retryable and idempotent. A retry must not double-sell a position or double-credit cash. The exact market-state selection policy for settlement at cutoff, including behavior during RPC or data outages and protocol migration, is **TBD**.

### 5.4 Market-state evidence

Every execution must reference an immutable or reproducibly serialized market-state record sufficient to answer, “Why did this user receive this fill?” At minimum record:

- protocol and adapter version;
- market/pool/curve identifier and token mint;
- observation timestamp and chain slot/block context;
- reserves or other relevant protocol state;
- fee parameters and route;
- requested input and simulated output;
- price impact and applicable fees;
- buy/sell direction and execution timestamp;
- migration state when relevant.

Where available, retain creator/deployer information and liquidity events to support later investigation.

## 6. Leaderboards and scoring

### 6.1 Hourly leaderboard

The hourly leaderboard should show rank, user or display wallet, current equity, current P&L, time remaining, current prize pool, and optionally current positions. During the round it is provisional. Final rank is determined only after settlement. The Top 10 receive real SOL.

Hourly ranking uses competition ranks such as `1, 2, 2, 4`. Tied users share the combined prize
allocation of the ordinal positions occupied by their tie group. If a tie crosses the Top 10 cutoff,
only funded ordinal positions contribute prize capital, but every member of the tie group shares that
capital equally. Stable user-ID ordering may assign indivisible lamport dust only; it never changes
competitive rank or implies superiority.

### 6.2 Daily leaderboard

The daily leaderboard ranks users by cumulative Paper SOL P&L across all completed hourly results in the active UTC day. The Top 25 receive real SOL after daily finalization.

Daily ranking uses the same tie policy as hourly ranking. Tied users share the combined funded ordinal
allocations occupied by the group. A tie crossing the Top 25 shares only the funded ordinal capital
among all tied users. Ties entirely below the cutoff receive no allocation.

Daily attribution is resolved: an hourly result belongs to the UTC Daily Championship containing its hourly round's authoritative start time, regardless of when settlement, reward finalization, payout, or indexer discovery occurs.

## 7. Creator-fee economics

### 7.1 Allocation modes

Only verified actual creator-fee revenue from the platform token funds the model. Estimated volume is not revenue.

The platform supports two mutually exclusive, versioned allocation modes. Each mode allocates exactly 100% of total verified creator fees.

**Normal Mode:**

- 63% to the current Hourly Reward System.
- 27% to the Daily Championship.
- 10% to the Platform Treasury.
- Total: 100%.

**Buffer Accumulation Mode:**

- 58% to the current Hourly Reward System.
- 5% to the Reward Buffer.
- 27% to the Daily Championship.
- 10% to the Platform Treasury.
- Total: 100%.

The explicit Reward Buffer contribution is deducted from the normal 63% hourly allocation. It is not added on top of the existing 100%. This source is appropriate because the Reward Buffer primarily supports future hourly rewards. The contribution percentage and Buffer Accumulation Mode enabled/disabled state are **CONFIGURABLE and versioned**. With the proposed 5% contribution enabled, the current hourly allocation is 58%; if the configured contribution changes, the current hourly percentage must change by the same amount so the complete allocation remains exactly 100%.

When Buffer Accumulation Mode is disabled, accounting returns to 63% hourly, 27% daily, and 10% platform. Existing Reward Buffer funds remain available to the dynamic hourly payout system even while new explicit contributions are disabled.

In both modes, 90% of total fees remains within the Player Reward System and 10% goes to the Platform Treasury. Normal Mode is equivalent to the original internal player split of 70% hourly and 30% daily. Buffer Accumulation Mode redirects five percentage points of total fees from the current hourly allocation into the player-owned Reward Buffer.

The Platform Treasury may pay operating costs including RPC, indexing, servers, databases, queues, monitoring, security, payout transaction costs, development, maintenance, support, and legal/accounting. Platform funds and player reward funds must be held and accounted for separately.

### 7.2 Same-hour funding

Verified creator fees generated during an hourly competition fund that same hourly competition; they are not deferred to the next hour. Attribution uses the event's authoritative on-chain event time/slot, not the time the platform's indexer discovers it. The displayed hourly prize pool grows as verified, deduplicated events arrive and freezes after the reward-finalization grace period, subject to the dynamic payout and buffer rules in Section 9.

For example, a fee generated at 15:59:58 UTC belongs to the 15:00–16:00 UTC competition even when discovered shortly after 16:00. A short `REWARD_FINALIZATION_GRACE_PERIOD` begins at the trading cutoff. Its initial proposed value is **60 seconds**, and it is **CONFIGURABLE and versioned**. During this period, the completed trading round is closed, settlement may proceed, the next hourly trading round starts immediately, and late-discovered on-chain fee events belonging to the completed hour may still finalize. The completed hour's real-SOL prize must not be broadcast until the grace period ends and reward accounting is frozen.

Once reward accounting is frozen, later data corrections must not silently change an already frozen or paid prize. They must enter an explicit reconciliation/error process with audit records. The precise reconciliation remedies remain **TBD**. Events must never be double counted or arbitrarily reassigned to another competition.

### 7.3 Daily pool

The daily allocation accumulates over the UTC day and is displayed live. At 00:00 UTC the previous pool freezes, the Top 25 finalize, payouts begin, and the next pool begins. The Daily Championship should primarily reflect actual daily revenue; no daily buffer support is approved for V1.

## 8. Payout curves and rounding

Payout curves must be centralized, versioned, validated configuration. Calculations use integer/fixed-point arithmetic and must define deterministic rounding and dust handling before real payouts.

### 8.1 Approved hourly Top 10 curve

| Rank | Approved share |
|---:|---:|
| 1 | 25.00% |
| 2 | 19.20% |
| 3 | 14.74% |
| 4 | 11.32% |
| 5 | 8.69% |
| 6 | 6.67% |
| 7 | 5.12% |
| 8 | 3.93% |
| 9 | 3.02% |
| 10 | 2.31% |

The approved hourly Top 10 curve sums to exactly **100.00%**. Ranks 1–9 are unchanged; rank 10 is 2.31%.

### 8.2 Approved daily Top 25 curve

| Rank | Approved share | Rank | Approved share |
|---:|---:|---:|---:|
| 1 | 15.000% | 14 | 1.893% |
| 2 | 12.792% | 15 | 1.614% |
| 3 | 10.909% | 16 | 1.377% |
| 4 | 9.303% | 17 | 1.174% |
| 5 | 7.934% | 18 | 1.001% |
| 6 | 6.766% | 19 | 0.854% |
| 7 | 5.770% | 20 | 0.728% |
| 8 | 4.921% | 21 | 0.621% |
| 9 | 4.196% | 22 | 0.530% |
| 10 | 3.579% | 23 | 0.452% |
| 11 | 3.052% | 24 | 0.385% |
| 12 | 2.603% | 25 | 0.326% |
| 13 | 2.220% |  |  |

The approved Daily Top 25 curve sums to exactly **100.000%**. Ranks 1–24 are unchanged; rank 25 is 0.326%.

### 8.3 Integer payout and dust policy

All real-SOL reward calculations use lamports/integer base units. Rank buckets use exact integer
largest-remainder allocation, with ordinal ascending as the deterministic fallback for equal
remainders. Underfilled fields renormalize occupied funded weights first. Funded buckets in a tie
group are combined and divided equally; indivisible tie dust uses stable user-ID ascending order.
That ordering is non-competitive and does not alter displayed rank. The full pool is distributed
exactly, and curve validation requires an exact 100% total at the declared precision.

## 9. Reward Buffer and dynamic hourly rewards

### 9.1 Ownership and purpose

The Reward Buffer belongs exclusively to player rewards and is never Platform Treasury money. It smooths extreme hourly revenue variation and provides limited protection as reward income weakens. It must never be silently transferred to the Platform Treasury.

The buffer may not go negative, and the platform must never promise funds it does not possess. Strong hours may remain much larger than weak hours; the mechanism does not target equal payouts.

### 9.2 Dynamic formula

The current conceptual formula is:

```text
P = B + λ(H - B)
```

Where:

- `P` is the target actual hourly payout;
- `B` is the recent baseline hourly reward level;
- `H` is the current hour's natural hourly reward allocation after the creator-fee split;
- `λ` is the volatility-preservation factor.

Initial values, all **CONFIGURABLE and versioned**:

- `λ = 0.60`;
- baseline is the arithmetic mean of the previous completed natural hourly reward allocations;
- baseline window is 12 completed hours by default.

A natural hourly reward allocation is the hourly reward amount after creator-fee mode splitting and before any dynamic-curve smoothing. The current in-progress hour, actual smoothed payouts, Daily Championship allocation, Platform Treasury allocation, and Reward Buffer contributions are not baseline inputs.

The dynamic curve activates only when the full configured baseline window exists. With the default window, 0–11 previous completed hours produce `INSUFFICIENT_BASELINE_HISTORY`: the current natural hourly reward is paid unchanged and the existing Reward Buffer is not used for smoothing. Explicit Reward Buffer accumulation may still occur in Buffer Accumulation Mode. Once at least 12 previous completed natural hourly allocations exist, the system uses the most recent 12, calculates their arithmetic mean rounded down to whole lamports, and applies the dynamic curve. V1 does not use partial-window averaging.

The system must not attempt to preserve launch-day rewards indefinitely; the rolling baseline must adapt to actual completed revenue conditions.

The dynamic curve always operates on the current hourly allocation after the creator-fee split. In Normal Mode, `H` starts from the 63% current hourly allocation. In Buffer Accumulation Mode with the proposed 5% contribution, creator fees first split into 58% current hourly allocation, 5% explicit Reward Buffer contribution, 27% daily, and 10% platform; the dynamic curve then operates on the 58% current hourly allocation.

If `H > P` because the current hour is unusually strong, the positive difference between natural hourly allocation and actual payout goes to the Reward Buffer. If `P > H` because the current hour is unusually weak, the difference comes from the Reward Buffer and is limited to the available balance. Therefore:

```text
if P <= H:
    actual_payout = P
    dynamic_excess_to_buffer = H - P
    buffer_support = 0

if P > H:
    buffer_support = min(P - H, available_buffer)
    actual_payout = H + buffer_support
    dynamic_excess_to_buffer = 0
```

All calculations must be deterministic and transparent. The Reward Buffer may never become negative. The explicit Buffer Accumulation Mode contribution and excess retained by the dynamic curve may both add to the same player-owned Reward Buffer.

### 9.3 Extra launch/high-revenue reserve accumulation

The architecture must support an explicit Reward Buffer contribution during strong or early revenue periods:

- proposed contribution: 5% of total creator fees (**CONFIGURABLE**);
- accumulation enabled/disabled (**CONFIGURABLE**);
- reserve target (**CONFIGURABLE; value TBD**);
- optional launch-phase flag (**CONFIGURABLE**);
- exact activation/deactivation policy (**TBD**).

These funds remain player reward funds. The proposal exists because smoothing alone may not accumulate enough reserve for later weak periods. As defined in Section 7.1, the explicit contribution is deducted from the current hourly allocation: at the proposed 5% setting, Buffer Accumulation Mode allocates 58% current hourly, 5% buffer, 27% daily, and 10% platform. It is never an additional allocation above 100%.

### 9.4 Daily interaction

Daily revenue naturally aggregates over 24 hours. Do not implement daily buffer support or complex daily smoothing unless explicitly approved later. Any future daily reserve support must be configurable and preserve player-fund ownership.

## 10. Architecture

### 10.1 Preferred stack

- TypeScript and Node.js.
- PostgreSQL as authoritative persistent storage.
- Redis for cache, distributed locks, queues, rate limits, and live ephemeral state only.
- Background workers for settlement, ingestion, finalization, and payout lifecycle tasks.
- Browser extension/overlay plus web dashboard.

Technology selections within these categories are **TBD** until the repository-foundation phase. PostgreSQL—not Redis—is the durable source of truth.

### 10.2 Server-authoritative boundary

Never trust client-provided balances, prices, P&L, rank, fills, token-slot counts, prize pools, or reward amounts. The client may submit authenticated intents and display server results. All rule checks and state transitions happen on the backend in concurrency-safe transactions or equivalent deterministic workflows.

### 10.3 Protocol adapters

The platform must support multiple Solana market types without baking one AMM or TOKEN/SOL assumption into generic competition logic.

A `ProtocolAdapter` is responsible for:

- identifying supported markets;
- loading and validating market state;
- quoting and simulating buys and sells;
- protocol-specific price impact and fees;
- token-specific and migration behavior;
- returning normalized, auditable execution results.

Potential venues include Pump-style bonding curves, migrated AMMs, Bags, Bonk-related launch systems, Moonshot-style systems, Heaven, and other relevant Solana venues. The exact Day-1 list is **TBD**. Adapter versions must be recorded with executions and broken adapters must be independently disableable.

### 10.4 Terminal adapters

A `TerminalAdapter` identifies the supported terminal/page and current Solana mint, attaches the overlay, and reacts to page navigation. Initial supported terminals are **Axiom, GMGN.ai, and Terminal.trade**. A terminal adapter must never contain pricing, AMM, bonding-curve, slippage, fee, P&L, or portfolio-accounting logic. A separate server-side `ProtocolAdapter` determines the actual market mechanics and realistic Paperfund execution.

### 10.5 Browser overlay

The preferred user experience is a browser extension or overlay on existing Solana terminals. It should eventually display:

- wallet/authentication status;
- round identity and countdown;
- Paper SOL cash, positions, and P&L;
- token slots used and maximum permitted buy;
- hourly and daily ranks;
- live hourly and daily prize pools;
- buy/sell controls;
- execution quote/fill detail;
- unambiguous simulated-trading labels.

### 10.6 Website

The website should include a dashboard, hourly and daily leaderboards, profile/history, prize-pool views, trade history, rules/documentation, and payout history.

Historical statistics may include rounds played, hourly wins, Top 3 and Top 10 finishes, daily wins, Daily Top 25 finishes, total real SOL won, best hourly/daily results, and historical paper P&L.

## 11. Domain state and financial records

### 11.1 Hourly state machine

Persist at least these conceptual states:

```text
SCHEDULED → OPEN → CLOSING → SETTLING → FINALIZED → PAYING → PAID
```

Allowed failure/retry states and transition rules are **TBD**, but transitions must be persisted, guarded, logged, and idempotent. Do not derive the state solely from current time.

### 11.2 Daily state machine

Persist at least:

```text
OPEN → CLOSING → FINALIZING → FINALIZED → PAYING → PAID
```

Allowed failure/retry states are **TBD** and follow the same persistence and audit requirements.

### 11.3 Ledger

Every financial state transition must be auditable, including:

- round starting credit;
- paper buy debit and token credit;
- token sell debit and Paper SOL credit;
- protocol/creator fee effects;
- force settlement;
- fee-revenue allocation;
- Reward Buffer contribution or support;
- prize and payout calculation.

Materialized balances may be maintained for performance, but they must reconcile to authoritative history. Ledger-entry identity and idempotency keys must prevent duplicate application.

### 11.4 Financial precision

Authoritative financial accounting must not use JavaScript `Number`. Use integer base units, `BigInt`, and explicit fixed-point decimal representations as appropriate for Paper SOL, token amounts, prices, fees, P&L, allocation ratios, buffer accounting, and payouts.

Real-SOL payout allocations must use lamports/integer base units. Rank conversion uses the approved
largest-remainder rule and tie division uses stable user-ID order only for indivisible dust, so the
full prize pool is distributed exactly. Other operation-specific fixed-point scales and intermediate
rounding directions remain **TBD** where not otherwise specified. Validation must reject percentage
configurations that do not meet the approved exact total.

## 12. Creator-fee ingestion

Every creator-fee event must be:

1. discovered;
2. verified on authoritative chain data;
3. deduplicated using stable event identity;
4. attributed to its correct UTC hour;
5. attributed to its correct UTC day;
6. split into the approved player/platform/hourly/daily/buffer buckets;
7. reflected in live prize accounting.

The same event must never be counted twice. Attribution is based on authoritative on-chain event time/slot rather than indexer discovery time. A configurable, versioned `REWARD_FINALIZATION_GRACE_PERIOD`, initially proposed as 60 seconds, follows each hourly trading cutoff. During it, the old round remains closed, settlement may proceed, the next round trades immediately, and late-discovered events for the completed hour may still finalize. No real-SOL prize for that hour may be broadcast until the grace period ends and reward accounting freezes.

After reward accounting freezes, later corrections enter an explicit reconciliation/error process and may not silently alter an already-paid prize. Reorg/finality policy, exact source programs/accounts, confirmation depth, and reconciliation remedies are **TBD/CONFIGURABLE**. Estimated trading volume must never substitute for verified fee revenue.

## 13. Real-SOL payout lifecycle

Recommended lifecycle:

```text
CALCULATED → FROZEN → VALIDATED → APPROVED → SIGNED → BROADCAST → VERIFIED
```

Payouts require unique IDs, idempotent jobs, duplicate-broadcast prevention, persisted transaction signatures, confirmation monitoring, retry policies, explicit failure states, and audit logs.

Payout private keys must use secure key management and must never appear in browser/extension code, source control, logs, or ordinary application configuration. Signing architecture, approval policy, custody model, confirmation policy, retry limits, and recovery procedures are **TBD**. Real payouts must not launch before security and legal/compliance review.

## 14. Manipulation and investigation posture

Do not over-engineer V1 anti-manipulation. The unique-token cap, maximum-buy rule, realistic execution, and forced settlement already constrain common paper-trading abuse. Expected rewards may also make costly real-market manipulation irrational, but this is not assumed as a guarantee.

Collect sufficient evidence for later investigation: mint, protocol, pool/curve, reserves, price, size, impact, fees, timestamps, recorded state, creator/deployer data where available, and liquidity events where available. Do not introduce arbitrary token-age bans without explicit approval.

## 15. Centralized versioned configuration

At minimum, centralize and version:

| Setting | Initial/proposed value | Status |
|---|---:|---|
| Starting Paper SOL | 10 | CONFIGURABLE; launch value approved |
| Max unique tokens per hourly round | 5 | CONFIGURABLE; launch value approved |
| Max buy ratio | 0.20 | CONFIGURABLE; launch value approved |
| Hourly winners | 10 | CONFIGURABLE; approved |
| Daily winners | 25 | CONFIGURABLE; approved |
| Player reward share | 90% of total fees | CONFIGURABLE; base split approved |
| Platform share | 10% of total fees | CONFIGURABLE; base split approved |
| Normal Mode allocation | 63% hourly / 27% daily / 10% platform | CONFIGURABLE; approved; totals 100% |
| Buffer Accumulation Mode allocation | 58% hourly / 5% buffer / 27% daily / 10% platform | CONFIGURABLE; approved at proposed 5% contribution; totals 100% |
| Hourly payout curve | Approved Top 10 table | CONFIGURABLE; totals 100.00% |
| Daily payout curve | Approved Top 25 table | CONFIGURABLE; totals 100.000% |
| Dynamic lambda | 0.60 | CONFIGURABLE; proposed |
| Baseline window | 12 completed hours | CONFIGURABLE; approved default; full window required |
| Reward Buffer balance | Runtime ledger-derived | CONFIGURABLE accounting source |
| Extra reserve contribution | 5% of total fees, deducted from hourly share | CONFIGURABLE; proposed |
| Buffer Accumulation Mode | enabled/disabled | CONFIGURABLE |
| Reserve target | no value approved | CONFIGURABLE; TBD |
| Launch-phase flag/policy | no exact policy approved | CONFIGURABLE; TBD |
| Reward finalization grace period | 60 seconds | CONFIGURABLE; proposed |
| Hourly round duration | 1 hour | CONFIGURABLE; approved competition cadence |
| Daily timezone | UTC | authoritative and approved |

Configuration must be immutable for a round once the round is open. Store the configuration version used by every round, execution, settlement, fee allocation, leaderboard finalization, and reward calculation. Rule changes normally affect only future rounds.

## 16. Important edge cases

The design and tests must explicitly cover:

- a trade at the exact cutoff, admitted only if its transaction authoritatively observes/locks the round in `OPEN` before the atomic `OPEN` to `CLOSING` transition;
- an in-flight order racing close, rejected unless admission was transactionally established while the round was `OPEN`;
- simultaneous buys and balance reservation;
- simultaneous first buys competing for the final token slot;
- protocol migration between quote and execution;
- unavailable or stale market data;
- zero or near-zero output;
- payout rank-bucket and tie-split dust, assigned by approved deterministic non-competitive rules;
- a late creator-fee event during the grace period and a correction after reward freeze;
- duplicate fee events and payout jobs;
- RPC/indexer outage;
- settlement retry and partial settlement recovery;
- hourly or daily leaderboard ties, including ties crossing the payout cutoff;
- an hourly round crossing the UTC-day boundary, attributed to the UTC day containing its authoritative start time (**policy resolved**);
- Reward Buffer exhaustion;
- configuration change near a round boundary;
- chain reorganization/finality changes (**policy TBD**).

No edge case may be resolved by fabricating a price, double-applying a transition, or spending unavailable funds.

## 17. Testing strategy

Testing is mandatory and is part of each phase's completion criteria.

### Unit tests

- starting/reset balance, token slots, and 20% validator;
- P&L and daily cumulative scoring;
- approved payout-curve validation;
- fee allocation and fixed-point rounding;
- dynamic reward formula and buffer solvency/accounting;
- state-machine guards;
- protocol-specific execution math.

### Integration tests

- database transactions and ledger reconciliation;
- orders, positions, and executions;
- hourly settlement and daily finalization;
- fee discovery, verification, deduplication, and allocation;
- buffer updates and payout creation;
- worker retries and idempotency.

### Concurrency tests

- simultaneous buys against cash and the 20% rule;
- simultaneous final token-slot acquisition;
- late order racing settlement;
- duplicate fee event ingestion;
- duplicate payout job/broadcast prevention.

### Replay tests

Recorded market states must reproduce deterministic quotes and fills for each adapter version.

### End-to-end tests

Wallet login, round participation, trades, settlement, leaderboard finalization, reward calculation, and eventually shadow/real payout flows.

## 18. Admin, audit, and observability

Admin tooling should eventually inspect current round/day, users/accounts, orders, executions, market states, settlement, fee events, Reward Buffer, prize pools, winners, payouts, failed jobs, and audit logs.

Emergency controls must support pausing trades, settlement, or payouts and disabling a broken protocol adapter. All admin actions require authentication, authorization, and audit logs. Exact roles and approval requirements are **TBD**.

Monitor at least trade volume, execution failure rate, RPC errors, latency, active users, settlement duration, creator-fee ingestion delay, Reward Buffer balance, hourly/daily prizes, payout failures, queue backlog, and adapter errors. Alert thresholds are **CONFIGURABLE/TBD**.

## 19. Legal, compliance, and security

Obtain qualified legal/compliance review for relevant jurisdictions before a public token launch or public distribution of real-SOL rewards. Engineering documentation must not make definitive legal claims. Public rules, eligibility, geographic restrictions, tax reporting, sanctions screening, contest classification, and any resulting KYC obligations are **TBD pending qualified advice**.

Security review is required before real-money payout activation. Never expose payout keys or user secrets. Authentication messages must prevent replay and domain confusion; exact nonce lifetime and signing-message format are **TBD/CONFIGURABLE**.

## 20. V1 scope

### Included

- wallet authentication;
- hourly engine and 10 Paper SOL reset;
- token slots and maximum-buy enforcement;
- realistic execution and protocol adapters;
- orders, positions, settlement, and ledger;
- hourly and daily leaderboards;
- cumulative Daily Championship;
- verified creator-fee accounting and live prize pools;
- Reward Buffer and dynamic hourly payout logic;
- hourly and daily rewards;
- real-SOL payout lifecycle;
- history;
- browser overlay and website;
- admin/audit tooling.

### Excluded unless explicitly added

- full custom trading terminal;
- copy trading or real-money user trade execution;
- managed prop accounts or profit sharing;
- ELO, divisions, teams, or social feed;
- native mobile applications;
- AI trading advice;
- heavy KYC or aggressive anti-Sybil controls;
- monthly reward competition.

## 21. Controlled build plan

Each phase should have a narrow task definition, tests, and review. Do not proceed past unresolved rules that materially affect that phase.

### Phase 0 — Repository foundation

Establish the TypeScript/Node monorepo or repository layout, formatting/linting/testing conventions, CI, environment/configuration patterns, package boundaries, and architecture decision records. Do not add financial behavior beyond structural scaffolding.

### Phase 1 — Pure competition engine

Implement framework-independent domain configuration/types and deterministic pure rules: hourly account reset, token-slot consumption, maximum-buy validation, hourly P&L, daily score accumulation, and state-machine concepts. Cover boundary and property tests without database or live-chain coupling.

### Phase 2 — Database and authoritative ledger

Design PostgreSQL persistence, transactional account/position/order models, append-only auditable financial history, idempotency keys, configuration versioning, and reconciliation. Prove simultaneous actions cannot overspend or exceed slots.

**Status: COMPLETE.** The implemented scope and remaining boundaries are recorded in Section 23.

### Phase 3 — Execution-engine abstraction

Define normalized market-state, quote, fill, fee, price-impact, and adapter-version contracts. Build deterministic fake/reference adapters for tests and replay infrastructure. Keep protocol math separate from competition logic.

### Phase 4 — First real Solana protocol adapter

Select the first protocol (**TBD**) and implement authoritative state loading plus buy/sell simulation validated against real protocol behavior. Record replay fixtures and handle migration/staleness explicitly.

### Phase 5 — Complete hourly vertical slice

Connect authentication, round state, trading, ledger, positions, live provisional ranking, close, force settlement, and final leaderboard using paper-only rewards. Validate idempotency, cutoff races, and outage recovery.

### Phase 6 — Daily Championship

Persist every completed hourly result, accumulate gains and losses using the approved round-start UTC attribution rule, run daily finalization, expose live/final leaderboards, and cover midnight behavior. Apply the approved shared-funded-ordinal tie policy during payout allocation.

### Phase 7 — Creator-fee tracking

Discover, verify, deduplicate, and attribute actual fee events by authoritative on-chain event time/slot; implement the two exact 100% allocation modes, the reward-finalization grace period, separated accounting, reconciliation routing, and live pool updates. Resolve chain finality and reconciliation remedies before production activation.

### Phase 8 — Reward Buffer and dynamic payout logic

Implement the versioned lambda and approved baseline formula, buffer ledger, solvency cap, explicit reserve accumulation configuration, transparent calculation records, and exhaustion/recovery tests. Do not implement daily smoothing without approval.

### Phase 9 — Shadow payout system

Run complete payout calculation and lifecycle records without broadcasting real SOL. Validate the approved curves, lamport allocation, rank-1 remainder policy, available balances, approvals, retries, and duplicate prevention.

### Phase 10 — Website

Build the dashboard, hourly/daily leaderboards, profile/history, prize pools, rules, trades, and payout history against authoritative APIs. Clearly distinguish provisional, finalized, mark, and executable values.

### Phase 11 — Browser extension and first terminal integration

Implement the secure overlay shell and first `TerminalAdapter` (**terminal TBD**), navigation/token detection, trading controls, status, balances, positions, ranks, prize pools, and execution details. Keep all financial authority on the server.

### Phase 12 — Real-SOL payouts

After legal, security, solvency, curve, rounding, custody, and operational approvals, enable secure signing/broadcast/verification with idempotency, monitoring, pause controls, and audited recovery procedures.

### Phase 13 — Additional protocols and terminals

Add adapters incrementally with protocol-specific math validation, replay fixtures, observability, independent feature flags, and safe disable controls.

## 22. Open decisions and known contradictions

The following are intentionally unresolved and must not be invented:

1. **Reserve policy:** target and launch/high-revenue activation/deactivation policy is TBD.
2. **Settlement data:** exact cutoff market-state and outage/recovery policy is TBD.
3. **Fee ingestion:** chain finality/reorg policy and post-freeze reconciliation remedies are TBD.
4. **Market-data freshness:** thresholds and reject/defer policy are configurable but TBD.
5. **Payout operations:** custody, approvals, confirmation, retry, and failure-recovery policies are TBD.
6. **Legal eligibility:** jurisdictional and compliance rules await qualified review.

**Resolved decision — Daily attribution:** Hourly results are attributed to the UTC Daily Championship containing the hourly round's authoritative start time.

**Resolved decision — Dynamic baseline activation:** The baseline is the floor of the arithmetic mean of the most recent full configured window of completed natural hourly reward allocations; the default window is 12 hours and partial windows do not activate smoothing.

**Resolved decision — Payout ties:** Tied users share the combined allocation of their occupied
funded ordinal positions. A cutoff-crossing tie shares only funded ordinal capital among every tied
user. Ties retain competition rank, and stable user-ID ordering is used only for indivisible dust.

The previously identified payout-curve, payout-tie, Reward Buffer source, payout-dust, order-cutoff,
late-fee attribution, and Daily Championship attribution ambiguities are resolved by Sections 3, 6,
7, 8, 9, 11, and 12.

No other contradiction was identified in the supplied hourly/daily competition rules: every hour resets to 10 Paper SOL; every completed hourly gain or loss contributes to the UTC-day cumulative score; hourly rewards go to Top 10 after realistic force settlement; daily rewards go to Top 25 after UTC-day finalization.

## 23. Corrected Phase 2 implementation record

Phase 2 establishes PostgreSQL as the authoritative store for hourly competition accounts, exact Paper SOL balances, token-slot use, orders, fills, positions, immutable accounting, finalized hourly results, and cumulative UTC Daily Championship results. Redis remains non-authoritative.

### 23.1 Product-model correction

The first Phase 2 implementation drifted into a monthly-season account and paper-top-up model. That model contradicted Sections 3 and 4 and has been removed. The current product has no monthly competition account, monthly reset, Paper SOL top-up, or `TOP_UP_CAPITAL` event. Monthly/all-time views may exist later only as analytics derived from preserved hourly/daily history.

Because the repository is pre-production and has no user financial data, the incorrect Phase 2 development migration was replaced and regenerated from the retained Phase 0 migration. This is an explicitly authorized development-history correction, not a safe pattern for a production database containing real data.

### 23.2 Corrected authoritative tables

Migration `packages/db/migrations/0001_wonderful_franklin_richards.sql` adds these tables without changing `app_meta`:

- `users`;
- `hourly_rounds`;
- `daily_competitions`;
- `competition_accounts`;
- `competition_token_slots`;
- `assets`;
- `markets`;
- `idempotency_records`;
- `orders`;
- `positions`;
- `fills`;
- `journal_transactions`;
- `ledger_entries`;
- `hourly_results`;
- `daily_results`;
- `daily_result_hourly_results`.

`competition_seasons` and `season_accounts` are not part of the canonical schema. Authoritative foreign keys restrict updates/deletes. Database triggers make token slots, fills, hourly results, daily contribution links, journal headers, and ledger entries immutable.

### 23.3 Hourly accounts and rule snapshots

Every `hourly_rounds` row is exactly one non-overlapping UTC-aligned hour and snapshots its starting Paper SOL, maximum unique tokens, maximum buy ratio in basis points, reward-finalization grace period, and rule version. Runtime behavior does not depend on later mutable configuration.

One user may have at most one `competition_accounts` row per hourly round. Initialization copies the round's configured starting balance—**10,000,000,000 lamports (10 Paper SOL)** by default—into a new account and records one balanced `HOURLY_STARTING_CREDIT` journal. Accounts, balances, positions, and token slots never carry into another hour. A depleted account receives no replenishment; the next hourly round creates a separate fresh account.

`competition_token_slots` records the first successful buy for each hourly account and asset mint. Selling does not delete or free a slot. Account locking and uniqueness serialize simultaneous first buys. The configured maximum is snapshotted on the hourly round; marked-portfolio calculation for the 20% maximum-new-buy rule remains later work.

### 23.4 Hourly results and UTC daily aggregation

`hourly_results` stores one immutable result per competition account with the authoritative round, user, starting balance, final settled balance, exact hourly P&L, and finalization time:

```text
hourly P&L = final settled Paper SOL - hourly starting Paper SOL
```

Finalization requires all positions to be closed and the submitted final balance to equal authoritative account cash. Database triggers require the result to match its account.

`daily_competitions` enforce one exact UTC-day window per date. `daily_results` stores each user's cumulative P&L and completed-hour count. `daily_result_hourly_results` immutably proves which hourly results contributed and prevents duplicate counting. Attribution uses only the authoritative hourly round start time, so a 23:00–00:00 round belongs to the UTC date containing 23:00 even when settlement completes after midnight. Positive, negative, and zero results all contribute.

### 23.5 Exact accounting, orders, fills, and positions

Paper SOL uses PostgreSQL `bigint` lamports and TypeScript `bigint`; token quantities use integer base units; execution prices use `numeric(38,18)` and validated decimal strings. JavaScript `Number` is not authoritative for financial values.

Double-entry journals use `CASH`, `POSITION_COST`, `HOURLY_STARTING_CAPITAL`, `TRADING_PNL`, and `TRADING_FEES`. Deferred database checks require positive lines for one competition account and equal debit/credit totals. The invariant is:

```text
cash + open position cost
= hourly starting capital + gross realized trading PnL - realized sell fees
```

Orders, fills, positions, idempotency, weighted-average cost basis, partial-sell integer rounding, final cost removal, buy-fee capitalization, and sell-fee accounting remain as documented in `docs/PHASE_2_LEDGER_AND_SCHEMA.md`, but all ownership is through an hourly competition account. Fills are immutable execution history and one order may have multiple fills without exceeding its requested amount.

### 23.6 Transactions, locking, and validation

Canonical SHA-256 request fingerprints and PostgreSQL uniqueness on `(operation_class, idempotency_key)` protect hourly-account initialization, order submission, fill application, hourly-result finalization, and daily-result contribution. There is no top-up operation.

Each mutation is one PostgreSQL transaction. Round-state locking guards order admission; order/account/position locking serializes fills; account locking serializes token-slot allocation and debits; result and daily aggregate locks prevent duplicate finalization or contribution. Any failure rolls back every partial mutation.

The real-PostgreSQL suite covers fresh and repeated migration, Phase 0 to corrected Phase 2, independent consecutive-hour accounts, exact 10 SOL initialization, no balance carry, absence of top-ups, duplicate initialization, token-slot uniqueness and limit races, order/fill/position ownership, duplicate orders/fills, same-position concurrency, overspending rejection, rollback, immutable balanced journals, weighted cost/P&L reconciliation, exact hourly results, cumulative daily results, duplicate-contribution prevention, and cross-midnight start-time attribution.

The complete suite has **200 passing tests**: the 186-test Phase 1 baseline plus 14 real-PostgreSQL corrected Phase 2 tests.

Detailed schema and accounting documentation is in `docs/PHASE_2_LEDGER_AND_SCHEMA.md`.

### 23.7 Known limitations and exact recommended Phase 3

Phase 2 does not implement protocol pricing, bonding curves, AMMs, slippage, market-state evidence, forced-settlement orchestration, leaderboard ranking, creator-fee ingestion, Reward Buffer persistence, payouts, custody, or real trading. The token-slot limit is persisted and transactionally protected; the 20% maximum-new-buy rule still requires authoritative marked portfolio valuation.

The exact recommended Phase 3 task is: define normalized immutable market-state, quote, fill, fee, price-impact, and adapter-version contracts; implement deterministic fake/reference execution adapters and replay fixtures; connect successful simulated results through the corrected hourly-account `createOrder` and `applyFill` APIs; and add authoritative transactional enforcement of the configured 20% maximum new buy. Do not add live Solana trading, creator-fee ingestion, or payouts.

## 24. Required Codex workflow

Future Codex prompts should begin with:

> Read PROJECT_CONTEXT.md completely before doing any work. Treat it as the canonical product and engineering specification. Do not change product rules unless this prompt explicitly overrides them. If this task conflicts with PROJECT_CONTEXT.md, stop and report the conflict before modifying code.

Tasks should remain small and controlled. A preferred early sequence is repository foundation; domain configuration/types; starting account/token slots/20% validator; positions/fake executions/ledger; hourly state machine/settlement; daily score; reward economics/curves; Reward Buffer formula; protocol adapter abstraction; and only then live Solana integration.

Application implementation must not begin until this context document has been reviewed.

## 25. Phase 3C implementation record

Phase 3C completes the paper-trading lifecycle through application-level authoritative SELL and
retryable hourly forced settlement. It does not add an API endpoint, frontend, ranking, creator-fee
revenue, rewards, payouts, or real Solana transactions.

### 25.1 Authoritative SELL

`executePaperSell` accepts an exact positive token base-unit quantity, loads explicit authoritative
market state through the registered production adapter, simulates exact-token SELL, and atomically
persists evidence, the order/fill, position/cost-basis mutation, net cash, realized P&L, balanced
journal, and idempotency result. Normal user SELL requires persisted `OPEN` state and the
authoritative timestamp in `[starts_at, ends_at_exclusive)`.

Partial basis removal uses the approved floor-proportional Phase 1C rule. A final SELL removes all
remaining basis and closes the canonical position row. Token slots are immutable consumption
history: closing does not release a slot, and a same-token rebuy reopens the existing position.

### 25.2 Forced settlement and finalization

At or after cutoff, `settleHourlyRound` transactionally advances `OPEN -> CLOSING -> SETTLING`, then
enumerates positions by protocol ID, market ID, and token mint. Each full-position liquidation uses
the same authoritative SELL implementation and commits in its own transaction. Deterministic
per-position idempotency makes concurrent workers and retries safe while allowing completed
liquidations to remain committed if another market fails.

An unavailable, invalid, or migrated market never receives a fabricated price. Its position remains
open and the round remains visibly `SETTLING` with a typed retryable failure. Pre-migration Pump.fun
curves remain the only supported Pump execution venue; `MARKET_MIGRATED` blocks finalization until a
future migrated-market adapter or approved recovery policy exists.

After all positions for an account are closed, ledger/materialized state must reconcile. The one
immutable hourly result is calculated from final cash minus snapshotted starting Paper SOL, then
contributed exactly once to the UTC day containing the round start. Negative, zero, and positive
results all count. The round reaches `FINALIZED` only after every account result exists; empty and
no-trade rounds finalize deterministically. Phase 3C does not transition to `PAYING`.

### 25.3 Audit and operations

Orders persist `NORMAL_USER` versus `FORCED_HOURLY_SETTLEMENT`; SELL fills persist exact net Paper SOL
output separately from gross proceeds and fees. `replayPersistedFill` verifies the evidence
fingerprint, resolves the recorded adapter version, deterministically re-simulates BUY/SELL, and
compares exact output without mutation.

The server-side adapter switch blocks new user BUY/SELL when disabled but deliberately permits
risk-reducing forced settlement while the installed adapter code remains available. No admin UI is
included. Market-state freshness thresholds remain TBD; timestamps and slots are recorded without
inventing a product threshold.

Detailed lifecycle, accounting, transaction-boundary, retry, replay, and limitation documentation is
in `docs/PHASE_3_EXECUTION_ENGINE.md`.
## 26. Phase 3D implementation record

Phase 3D preserves a Pump-origin position across migration and executes it through the current
canonical PumpSwap destination. `PUMP_FUN` and `PUMP_SWAP` remain separate production protocols.
The server reads the original curve, derives the canonical index-0 PumpSwap pool from verified PDAs,
and routes active curves to the bonding adapter or completed SOL-paired curves to
`pump-swap-canonical-v1`. Client-supplied destinations and hidden fallback are forbidden.

Economic position identity remains the original hourly-account/asset/Pump-market row. Migration does
not alter quantity, cost basis, realized P&L, or historical entry fills. Current venue identity is an
execution-time concern: a migrated exit order/fill/evidence records PumpSwap while its immutable
evidence link identifies the original position. This minimum evolution required no schema migration.

The PumpSwap state source validates canonical linkage, account owners/discriminators, mint/vault/token
program identities, initialized accounts, physical/effective reserves, flags, and dynamic fee state.
Simulation uses exact constant-product integer math, effective quote reserves, independently
ceiling-rounded LP/protocol/creator fees, and the official exact-input BUY correction. Exact-token
SELL and full-exit valuation share one path.

Portfolio valuation, voluntary SELL, and forced hourly settlement resolve the route before loading
state. Missing or unsupported destinations leave state unchanged with a typed retryable failure.
Forced settlement may use installed adapter code when new trading is disabled. Recorded mainnet
fixtures and offline golden tests cover normal, shallow, and deep pools and linked completed curves.
Detailed mechanics, sources, rounding, evidence, tests, and limitations are in
`docs/PHASE_3_EXECUTION_ENGINE.md`.

## 27. Phase 4A implementation record

Phase 4A exposes the authoritative competition engine through `/api/v1` and adds persisted,
restart-safe hourly lifecycle orchestration in `apps/worker`. Infrastructure health remains at
`/health` and `/ready`. No frontend, creator-fee ingestion, reward calculation, payout, or real trade
was added.

Wallet authentication uses exact UTF-8 message signing with an Ed25519 Solana public key. Redis holds
short-lived, wallet-bound, atomically consumed challenges and opaque revocable sessions; PostgreSQL
stores the one-wallet/one-user identity. Browser transport uses an HttpOnly session cookie with
configurable Secure and SameSite behavior. Redis also holds bounded auth/trade rate-limit counters,
but never financial authority.

The worker idempotently creates the current and next exact UTC hourly windows, creates the UTC daily
competition, opens due rounds, discovers ended or partially settling rounds from PostgreSQL, and
reuses `settleHourlyRound` until finalization. A new hour is independent of prior settlement. Daily
attribution remains based exclusively on hourly round start time.

The API supports current round and entry, authoritative account/position reads, Pump-origin BUY,
partial or `ALL` SELL, stable trade history, hourly result history, finalized hourly and current daily
leaderboards with explicit tie metadata, daily competition state, and Pump.fun/PumpSwap market
support resolution. Financial JSON fields are exact strings. Trade idempotency uses the required
`Idempotency-Key` header and fingerprints financial intent without volatile HTTP arrival time.

Developer configuration, auth flow, endpoint examples, unit conventions, error envelopes, and
lifecycle behavior are documented in `docs/API.md`. PostgreSQL remains authoritative for every
round, balance, position, fill, journal, and result; Redis remains ephemeral.

## 28. Phase 4B implementation record

Phase 4B replaces the `apps/web` placeholder with the first user-facing Paperfund application. The
frontend uses React, TypeScript, Vite, React Router, and TanStack Query. Its dark, responsive trading
shell provides Trade, Hourly, Daily, and History routes without adding a browser extension, real
trades, deposits, reward economics, payouts, or admin behavior.

The browser supports Phantom-compatible injected Solana providers. Wallet connection and Paperfund
authentication are separate explicit actions: the user connects, requests the Phase 4A challenge,
signs the exact UTF-8 message, and establishes the existing HttpOnly cookie session. Wallet signing
is authentication-only. No session token, private key, seed phrase, RPC secret, or server secret is
available to frontend code.

The web API client centralizes its public base URL, credentialed requests, typed error envelopes,
pagination, and per-action idempotency headers. Financial JSON remains exact string data and client
calculations use `BigInt`; partial-sell percentages floor integer token base units and SELL ALL sends
the authoritative `ALL` intent. The API still does not expose a read-only authoritative max-buy
preflight. The UI's MAX shortcut therefore uses the safe conservative bound of 20% of current cash,
while the backend continues to value all positions and enforce the exact portfolio-equity rule at
submission. This shortcut may understate the available maximum when open positions have value.

The current-round countdown derives a display offset from API server time and updates locally between
polls. Persisted round state and backend transaction admission remain authoritative. The app polls
round/account state every four seconds, leaderboards every eight seconds, and trade activity every
fifteen seconds plus after mutations. A changed round ID is surfaced without carrying forward the
prior account, positions, or balance; the most recent finalized result is shown with the next entry
prompt when available.

Market inspection displays only backend-confirmed Pump.fun/PumpSwap support and decimals. Position
valuation remains explicitly unavailable because Phase 4A does not expose authoritative executable
values. Trade history distinguishes `FORCED_HOURLY_SETTLEMENT` as `AUTO CLOSE`, and leaderboard ties
use backend ranks and tie metadata without a client-side tie-break.

Local `npm run dev` now starts API, worker, and web together. Local web/API origins are configurable
through `VITE_API_BASE_URL` and `ALLOWED_ORIGINS`. Component tests cover authentication states, round
entry and transition, BUY and typed rejection, positions, partial SELL, SELL ALL, and both
leaderboards. A browser-level Playwright smoke harness is deferred to avoid adding a second mock
runtime; no frontend test requires live Solana RPC. Detailed architecture and limitations are in
`docs/WEB_APP.md`.

## 29. Phase 4C implementation record

Phase 4C adds an authenticated, read-only BUY preflight without changing competition rules or
duplicating execution math. For every open position the API resolves the current execution route and
reuses full-exit adapter valuation. Portfolio equity is exact cash plus all executable exit values;
the ratio maximum is the existing basis-point floor calculation, and the effective maximum is the
lesser of that result and cash. Existing exposure to the target token does not reduce the per-order
limit. It only avoids consuming another immutable token slot.

Preflight returns exact string values, market/current-protocol support, target-slot impact, server
time, and explicit valuation availability. If any open position cannot be valued, equity and maximum
are unavailable rather than partial or fabricated. Preflight is advisory and makes no financial
mutation; the existing BUY transaction always reloads authoritative execution state and remains the
final authority for ratio, cash, slot, and round admission. Idempotent registration of public market
routing metadata during market inspection is not a financial state transition.

`/api/v1/positions` now returns net executable full-exit value, signed unrealized Paper P&L, current
protocol, evidence fingerprint/observation metadata, and explicit status per position. Pump-origin
history remains immutable while a migrated position is valued and displayed through PumpSwap.
Account-level equity and live Paper P&L are emitted only when every open position is available; live
P&L is provisional and is neither persisted nor used for result finalization or leaderboards.

The web keeps its four-second persisted account poll and performs the at-most-five-position valuation
query on a separate twelve-second interval. The inspected-mint preflight also refreshes every twelve
seconds and after mutations. No cache was added: UI snapshots are advisory, and transaction execution
never consumes them. Market freshness thresholds remain TBD, so no stale cutoff was invented.

The BUY ticket now uses the exact backend maximum, displays cash/equity/venue/slot impact, disables
known over-limit requests, and still handles transactional race errors. Positions display cost basis,
executable value, unrealized P&L, entry venue, and current venue. The account summary distinguishes
cash, exact portfolio equity, and provisional Live Paper P&L without redesigning the approved shell.

A single Playwright smoke builds and serves the actual web app, starts the real API/service stack over
a disposable migrated PostgreSQL database, runs the lifecycle tick, injects a deterministic test-only
Ed25519 wallet, and uses recorded Pump market state plus in-memory ephemeral sessions. The browser
blocks all non-local requests. It proves connect, challenge signing, entry, 10 Paper SOL, exact MAX,
BUY, executable valuation, SELL ALL, and trade-history update without Phantom, mainnet RPC, real SOL,
or external network. No schema migration was required. Detailed contracts and operation are recorded
in `docs/API.md` and `docs/WEB_APP.md`.

## 30. Phase 4D implementation record

Phase 4D replaces the browser-extension placeholder with a Chromium Manifest V3 overlay for Axiom.
Research on 2026-09-25 verified `axiom.trade` as the production host and the current Solana trading
route as `/meme/<mint>`, with an optional referral suffix and `chain=sol` query. The adapter rejects
the non-Solana `/token/` route and validates the path mint by decoding it as an exact 32-byte base58
Solana public key. It does not scrape token names, symbols, chart text, or hashed CSS classes.

`AxiomTerminalAdapter` is separate from every `ProtocolAdapter`: it observes page navigation and
returns only the currently viewed token mint. A small page-context bridge reports push/replace-state,
popstate, and hash navigation and exposes only wallet public-key lookup, connect, and authentication
message signing. It has no generic provider RPC and no transaction-signing operation. The overlay is
rendered in a Shadow DOM and uses a background service worker for all Paperfund API calls.

Extension authentication reuses the existing Ed25519 challenge/session system. An explicitly
requested extension verify response returns the same opaque Redis session token to the signing
client; the MV3 service worker stores it only in `chrome.storage.session` and sends bearer requests.
The token never enters the Axiom page context, DOM, or locally persisted preferences. The existing
web app continues to use its HttpOnly cookie response unchanged.

The compact overlay implements explicit connect/sign-in, current round and server-offset countdown,
entry, cash/equity/slots, backend-resolved market venue, authoritative BUY preflight/MAX, BUY,
current-position executable valuation, exact integer percentage SELL, authoritative `ALL`, recent
activity, previous-round feedback, collapse, local enable/disable, and a full-app link. Round/account
polling runs every 4.5 seconds and current-market/preflight refresh every 10 seconds while visible;
hidden tabs pause polling and refresh on return.

Mint changes immediately clear old market and preflight state. Async results are accepted only when
their captured mint still matches the current terminal mint, and every trade control requires the
currently detected mint to equal the fully loaded mint. Unsupported or drifted routes therefore
fail closed and never retain a prior token. Financial values remain exact strings/`BigInt`; all
financial authority, execution routing, rule checks, positions, fills, settlement, and results remain
on the existing backend.

The manifest requests only `storage`, an exact build-time Paperfund API host, and the
`https://axiom.trade/*` content/bridge scope. Its CSP permits local extension scripts only. A minimal
toolbar popup controls overlay visibility and links to the web app. Deterministic adapter/component
tests plus a fixture Axiom page, message-only wallet, and in-memory API harness cover the full overlay
lifecycle without live Axiom, an injected production wallet, RPC, or real SOL. Full MV3 Playwright
bundle loading is deferred; detailed architecture, permissions, build/install steps, tests, security
review, and limitations are in `docs/EXTENSION.md`.

## 31. Phase 4E implementation record

Phase 4E completes headed Manifest V3 acceptance and release hardening for the Axiom overlay without
changing competition rules or adding real trading. A Playwright harness now loads the unpacked
extension in a headed Chromium profile, runs against the real local API and a disposable migrated
PostgreSQL database, and uses recorded protocol state plus a deterministic message-only Ed25519
wallet. It covers rejected and accepted wallet connection/signing, entry, exact MAX, BUY, 25% SELL,
SELL ALL, stale-mint fail-closed behavior, popup rendering, collapsed-state persistence, and service
worker termination/recovery. A separate non-trading smoke confirms safe injection on the current
public Axiom route; authenticated Axiom terminal content remains outside automated acceptance.

Headed acceptance found and fixed two browser-only defects. The dynamically imported overlay bundle
and chunks are now declared as web-accessible resources exclusively for `https://axiom.trade/*`, so
the manifest bootstrap can load while preserving the narrow host boundary. Round entry now treats
the API's creation result as the minimal response it actually is and reloads the authoritative full
account before rendering positions. Market refresh and mint-change cleanup are separated so normal
account/preflight refreshes cannot erase trade feedback or ticket state.

Release builds require explicit public API and app URLs, validate credential-free HTTP(S) syntax,
and require HTTPS except for an explicit loopback-only development override. The extension version
comes from its package metadata. `npm run package:extension` performs a production build and emits a
clean versioned unpacked directory under `artifacts/`, rejecting source maps, fixtures, dependency
trees, environment files, and common server-secret markers. The generated manifest retains only the
`storage` permission, the exact configured API origin, the Axiom content/bridge match, a local-script
CSP, and the Axiom-scoped bundle resources. Release, installation, recovery, headed fixture, and live
smoke procedures are documented in `README.md` and `docs/EXTENSION.md`.


## 32. Phase 5A implementation record

Phase 5A adds authoritative creator-fee funding and reward-pool accounting without winner allocation,
payout custody, signing, broadcasting, or real-SOL transfers.

Verified creator-fee events use immutable exact lamports, authoritative event time, slot, source, and
the unique chain identity `(transaction signature, event index)`. Only verified, attributed events
are counted. Attribution uses the hourly round's UTC `[start, end)` window, never discovery or
processing time. The source boundary currently includes deterministic fixtures only; a live
Pump/PumpSwap watcher is deliberately absent because official event semantics, real-chain examples,
and finality/reorg policy were not verified to production confidence within this phase.

Hourly reward finalization begins only after the round's snapshotted grace period, defaults to 60
seconds, and is independent of trading settlement and the next round. One PostgreSQL transaction
uses an hour advisory lock plus Reward Buffer row lock to total events; apply the approved
63/27/10 or 58/5/27/10 largest-remainder split; add explicit buffer capital; calculate the full-window
baseline and exact lambda target; cap weak-hour support at available capital; persist the immutable
hourly snapshot, daily contribution, platform allocation, buffer movements, and counted-event state;
and enforce exact conservation. Uniqueness and locking make worker retries and concurrent finalizers
idempotent.

The baseline is the floored mean of the most recent full configured window of frozen natural hourly
allocations ordered by round start; 12 remains the default, and partial windows do not smooth. The
default lambda remains 6000 basis points. Reward Buffer movements are immutable, signed, and
reasoned; its materialized balance is nonnegative and locked. Daily totals are derived from immutable
per-hour contributions and protected against silent divergence. Platform amounts remain separate.

Events discovered after freeze are retained as `LATE_AFTER_FREEZE` with an explicit reconciliation
record and never mutate a frozen pool. Public read endpoints expose exact-string provisional versus
frozen hourly/daily values and an audit response with events, baseline inputs, movements, and
conservation. Detailed contracts and limitations are in `docs/REWARDS.md` and `docs/API.md`.

## 33. Phase 5B implementation record

Phase 5B expands the one Manifest V3 extension and one shared Paperfund overlay to the initial
supported trading terminals: **Axiom, GMGN.ai, and Terminal.trade**. Each content-script instance
owns only its tab's terminal and current-mint context. Authentication, hourly account, Paper SOL,
slots, positions, trades, results, and polling remain shared and server-authoritative. The background
worker stores no global mint. A trade on one tab appears in the others through the existing
authoritative refresh cycle.

The terminal registry resolves exactly one host-specific adapter and throws on ambiguous matches in
development/tests. Unsupported hosts receive no content script; unsupported pages, malformed mints,
and non-Solana contexts clear the current mint. The adapters recognize only current verified URL
contracts: Axiom `https://axiom.trade/meme/<mint>[/@referrer]?chain=sol`, GMGN
`https://gmgn.ai/sol/token/<mint>`, and Terminal
`https://www.theterminal.trade/token/<mint>?network=solana`. Shared history hooks cover
`pushState`, `replaceState`, `popstate`, and `hashchange`; a coalesced mutation observer detects
framework navigation fallback without site-specific polling or text scraping.

`TerminalAdapter` identifies the terminal/page/current Solana mint only. `ProtocolAdapter` remains
the server-side authority that selects Pump.fun or PumpSwap and performs pricing, curve/AMM math,
slippage, fee, P&L, and portfolio accounting. The terminal never selects execution mechanics.

The approved primary Paperfund brand asset is the **black interlocking PF mark with a green
horizontal accent**. It is user-approved and must not be invented, redrawn, recolored, or distorted.
The binary asset was not present in the repository during Phase 5B, so asset wiring is deferred to a
later branding pass and does not block terminal support.

## 34. Phase 5C implementation record

Phase 5C converts finalized authoritative hourly and daily prize pools into persisted shadow payout
plans. It does not create transactions, hold payout keys, sign, broadcast, transfer SOL, or mark any
allocation paid. The stable curve identifiers are `hourly-top10-v1` and `daily-top25-v1`; the tie
policy identifier is `combined-funded-ordinals-v1`.

Allocation reads only finalized competition results and frozen/final reward pools. Exact bigint
largest-remainder math converts the applicable curve weights into ordinal rank buckets. Underfilled
fields renormalize the occupied funded ordinal weights to the full pool. Each tie group combines its
funded ordinal buckets and divides them equally across all tied users. When a tie crosses the cutoff,
only funded ordinal buckets contribute. Stable user-ID ascending order assigns indivisible tie dust
without changing competition rank. Negative scores remain eligible. Every plan conserves exactly:
the sum of user allocations and rank buckets equals the frozen prize pool.

Forward migration `0005_past_zaran.sql` adds payout plans, persisted rank buckets, and user
allocations with source/curve/tie snapshots, unique source/version constraints, lifecycle guards,
immutable financial details, and deferred conservation validation. Plans progress through
`CALCULATED`, `FROZEN`, and `VALIDATED`; `APPROVED` is reserved for later operational approval.
Normal generation never mutates a frozen plan. PostgreSQL advisory locks plus uniqueness make
generation idempotent and concurrency-safe.

The worker freezes a daily reward pool only after its daily competition and every contained hourly
reward pool are final, then generates eligible hourly and daily plans independently of the next
trading round. The validator replays the configured curve against current authoritative results and
checks source finality, versions, participants, ranks, ties, buckets, duplicates, nonnegative amounts,
winner counts, and conservation. Audit reads expose source leaderboard snapshots, exact curve
buckets, tie explanations, dust adjustments, final allocations, and a conservation proof.

Public read APIs expose hourly winners, daily winners, and sanitized plan audits. Authenticated users
can read their own pending allocations. Hourly history shows finalized rank and pending reward
allocation without claiming payment. Detailed contracts, lifecycle, rounding, APIs, limitations, and
operational boundaries are in `docs/PAYOUTS.md` and `docs/API.md`.

Phase 5C validation completed with 328 passing tests and 2 intentional skips, 32/32 extension tests,
clean lint and typecheck, successful production build, applied forward migration and DB readiness,
and the real-stack web Playwright flow passing. At the end of Phase 5C, a positive frozen pool with
zero participants still failed closed; Phase 5D below supersedes that temporary gap with the
canonical Reward Buffer carry-forward rule.

## 35. Phase 5D implementation record

Phase 5D adds the controlled real-SOL payout execution boundary. The canonical lifecycle is now
`CALCULATED → FROZEN → VALIDATED → APPROVED → SIGNED → BROADCAST → VERIFIED`, with explicit
retryable, final-failure, and reconciliation-required states. Approval is a server-side operator CLI
action and records operator, source, timestamp, and immutable plan-snapshot hash. The worker does not
approve, sign, or broadcast payouts.

Forward migration `0006_secure_payout_execution.sql` adds approval, execution, deterministic batch,
batch-allocation, broadcast-attempt, and zero-participant outcome records. Each allocation can belong
to only one execution batch. Intent hashes commit to plan, batch index, explicit network, treasury,
ordered destinations, and exact lamports. Network fees are treasury/platform operating costs and
never reduce winner allocations.

Real execution defaults off. The operator CLI defaults to dry-run and live mode requires an explicit
enable switch, configured network and treasury, enabled server-side signer, matching signer public
key, matching RPC genesis hash, and sufficient treasury balance for payouts plus estimated fees.
Mainnet additionally requires separate acknowledgement. Private key material is loaded only from
server environment for the gated development local-keypair signer and is never persisted, logged,
returned by APIs, or sent to web/extension code. Signer and Solana RPC boundaries allow future HSM,
hardware, multisig, or remote implementations.

Transaction batches use exact bigint lamports and conservative deterministic recipient limits.
Prepared intent is persisted before signing; signed bytes and their derived signature are persisted
before broadcast. A send response never means payment success. `VERIFIED` requires Solana finalized
status and exact on-chain System Program transfer comparison against stored treasury, recipients,
and amounts. Ambiguous broadcasts reconcile the known signature before retry. Only a transaction
proven absent after blockhash expiry may be rebuilt from the same immutable intent; verified batches
remain untouched during partial retries.

The canonical zero-participant rule is now resolved: when a finalized hourly or daily player reward
pool has zero eligible participants, no fake winner or payout plan is created, nothing is burned or
routed to platform accounting, and the complete player-designated amount is atomically carried into
Reward Buffer. The immutable reason is `ZERO_PARTICIPANT_CARRY_FORWARD`, paired with a source-unique
outcome so retries remain exact and idempotent.

User reward reads distinguish pending, approved, processing, paid, and failed/review. Only a fully
reconciled `VERIFIED` plan appears paid. Commands, configuration, finality policy, retry and security
behavior are documented in `docs/PAYOUTS.md`. Phase 5D does not add an admin dashboard, multisig UI,
treasury funding/sweeps, withdrawals, KYC/tax reporting, or arbitrary payout editing.

Phase 5D validation completed with 336 passing tests and 2 intentional skips, 32/32 extension tests,
clean formatting/lint/typecheck, a successful production build, passing database readiness, and the
real-stack web Playwright flow. Live devnet/mainnet payout smoke was deliberately not run because no
funded operator treasury or signer secret is part of the repository or deterministic test setup.

## 36. Phase 5E implementation record

Phase 5E adds a production-capable, read-only Solana creator-fee ingestion pipeline for the two
already-supported Pump venues without changing trading, reward economics, winner allocation, or
payout execution. Official current Pump and PumpSwap IDLs and creator-fee documentation establish
that exact fees accrue per successful trade into program-defined creator vaults and are claimed
later. Paperfund therefore ingests the authoritative per-trade event and never counts a later
collection instruction as new revenue.

`SolanaPumpCreatorFeeSource` scans only the explicitly configured Paperfund token mint. Pump
`TradeEvent` evidence must match the canonical Pump program, a trade instruction, mint, creator,
native/wrapped-SOL quote, creator-vault account semantics, and exact positive `creator_fee`. PumpSwap
`BuyEvent`/`SellEvent` evidence must match the canonical AMM program and same-transaction instruction
pool, configured base mint, wrapped-SOL quote, creator, creator-vault accounts, and exact positive
`coin_creator_fee`. Non-zero holder-reward or cashback paths are rejected because they are not
unambiguous creator-wallet revenue. The chain identity is transaction signature plus event log index.

Discovery persists observations separately from financial verification. Observed and confirmed
transactions never fund rewards. Only Solana `finalized` status promotes the exact event into the
existing immutable `creator_fee_events` model as `VERIFIED`. Chain `blockTime` is authoritative and
retains the existing half-open hourly `[start,end)` attribution and late-after-freeze behavior.
Pre-finality disappearance becomes `ROLLED_BACK`. Recent local finalizations are continuously audited
against status, refetched event evidence, and the canonical row; any inconsistency becomes
`RECONCILIATION_REQUIRED` with a durable finding and never silently rewrites financial history.

Forward migration `0007_live_creator_fee_ingestion.sql` adds observation/finality state, durable
per-source checkpoints and health/error data, and reconciliation findings. The checkpoint advances
only after durable observations, so crash replay is harmless under chain-identity uniqueness. The
worker runs ingestion in an independent failure boundary with bounded serial RPC reads,
timeout/retry/backoff, and configurable rate limiting. It cannot sign, construct, send, trade, claim,
or sweep. Live following defaults off and fails closed when token-mint or creator-wallet identity is
missing.

Operators can inspect health with `npm run creator-fees:status` and run an explicitly bounded,
half-open, finalized-only, cursor-independent backfill with `npm run creator-fees:backfill --
<from-slot> <to-slot-exclusive> [max-transactions]`. Real mainnet Pump and PumpSwap event payloads are
stored as offline fixtures. Deterministic coverage verifies exact decoding, program/instruction and
identity false positives, finality promotion, rollback/reconciliation escalation, restart recovery,
hour-boundary attribution, bounded backfill, and replay idempotency. Detailed semantics,
configuration, operations, security properties, and limitations are in `docs/REWARDS.md`.

Phase 5E validation completed with 342 passing tests and 2 intentional skips, including 6 new
fee-ingestion tests; 32/32 extension tests; clean formatting, lint, and typecheck; successful web and
extension builds; applied migration and passing database readiness; and the real-stack web
Playwright flow. An optional read-only mainnet parser smoke passed against the two captured Pump and
PumpSwap signatures and exact fees. A configured end-to-end Paperfund mainnet follow smoke was not
run because the repository does not contain an approved Paperfund token-mint/creator-wallet funding
identity; ingestion remains disabled by default and fails closed without it.
