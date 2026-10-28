# Ten-minute pre-mint handoff — review only

Status: PREPARATION. Nothing here is a financial approval or a deployment instruction. This file belongs to a draft GitHub branch, not the installed protected Windows operator bundle. An address reserved for a forthcoming token does NOT establish an on-chain mint, creator, route, or earning event.

## Identities to pin and verify
- Official intended developer/creator: `7BRznQJJbj5EFpMeafDc5c4oaCHSBchBiLagx9DRL6Sz`. Not yet enrolled in the protected development signer.
- Historic backing wallet: `8x4L1a7vEFqvJu5B2GceMRjNVtSGgnwuHKuJH69aruae`. Never relabel or rotate its protected historical liabilities to 7BRzn.
- Reward treasury: `Tt1rWaCT329MXgmPixU4aYtcXCmpS6fDDE5bGcYweXv`.
- 10% platform-fee destination: `53sJCZ59TSkVynoD9SfaAXZMKyZtvRgN9QZTrzqRXrbx`.
- Official mint: `ACTUAL_MINT` (reserved address is not verified until created and finalized).

## Before mint creation
1. Owner confirms launch configuration: native SOL quote, correct creator set to 7BRzn, direct single-creator fees, and whether fee sharing or cashback may be enabled. An incompatible feature is a financial HOLD, not a reason to guess or route around safeguards.
2. Independently verify any available treasury operator deposit. Latest owner-supplied Solscan screenshot shows Tt1r balance 10,655,240 lamports including a 10,000,000-lamport incoming transfer from 7BRzn. Finalized signature, instruction index and non-player operator-fee classification require independent verification. Existing protected reserve 650,240 and historical escrow 4,984 are unchanged.
3. Verify unrestricted claim transaction gas in 7BRzn, distinct from mint-creation costs and any player liabilities. Do not reuse the 8x4L historical balance.
4. Keep the existing public PAPER system running independently. Preserve its current-hour UTC cutoff evidence. No pre-mint creator fees may be inferred.
5. Retain a rollback/no-go path: STOP asserted, claims/hourly/daily OFF, old keys untouched, no user-facing promise of guaranteed reward settlement.

## After real mint finality — minimal exact acceptance order
1. Read-only verify the actual mint on **two independent mainnet RPCs**: owner/creator, mint owner/token program, native SOL quote, cashback status, fee-sharing config, Pump curve, migration status, canonical PumpSwap pool and coin_creator. A reserved or merely signed-but-unfinalized mint is insufficient.
2. Prepare an exact owner-reviewed replacement binding for the **development signer only**, scoped to 7BRzn; enroll protected key ownership without pasting secrets into chat or GitHub. Preserve 8x4L historic backing and Tt1r protected treasury custody. Verify each updated config hash and required minimal worker-only change against the **installed** Windows bundle.
3. Check actual claim topology:
   - Pump creator vault: `collect_creator_fee_v2` as currently implemented only for verified supported direct, SOL-paired curve state.
   - PumpSwap graduated canonical pool: `collect_coin_creator_fee` to creator WSOL ATA; account creation, rent, token-program ID and WSOL-to-SOL conversion are separate costs and evidence. This route is NOT implemented in the protected claim adapter yet and MUST NOT be described as live or approved.
   - For latest trade variants (Pump v3 / PumpSwap v2), accrued protocol/creator fees may require a separate permissionless **sweep** instruction before vault collection. Verify pending fees versus actually collectable vault amounts. Do not credit unswept, unclaimed or unconverted fees.
   - Fee-sharing/cashback routes require separate verified ownership and route support; otherwise HOLD.
4. Obtain independently reviewed, short-lived, STOP-generation-bound development claim/distribution authorization. Real claimed revenue must be finalized, token-attributed and reconciled by earning UTC periods before any prize credit. Split 63% hourly / 27% daily / 10% platform, with true platform-borne network expenses.
5. Verify Tt1r received funds and classify each independently verified receipt as `NETWORK_FEES` or `CREATOR_FEE` according to the *actual* on-chain source and accepted accounting. Unrestricted operator gas does not create player prize principal. Reserve, historic escrow, full daily liability and any buffer remain protected.
6. After UTC cutoff plus the real finalization grace, verify full source/quote/clock evidence, accepted fee revenue, genuine immutable winner amounts, fees and complete solvency. Obtain the separate exact first funded-plan owner approval before hourly-only execution. Keep daily payouts held.
7. Recurring automatic claiming and subsequent hourly payouts need their OWN reviewed bounded standing scopes and expiry. One-off pilot approval is not indefinite authority. STOP stays asserted until each relevant independent authorization/acceptance stage passes.

## Hard NO-GO conditions
- No actual finalized mint or creator mismatch; unsupported PumpSwap/graduation/sharing/cashback topology; unavailable protected 7BRzn signer; insufficient unrestricted payer gas; lack of authentic fee claims or actual earning-hour attribution; unsettled treasury receipt; absent winner evidence or plan; changed recipient or balance; no current independent financial authorization; any STOP-generation mismatch.
- No spontaneous signer rebind, on-chain authority transfer, auto-retry of uncertain transfers, historical-fund use, or global payout switch.

## References in this repository
- `scripts/operator/creator-fee-route-readiness.mjs` — offline classification only
- `scripts/operator/automation-claim.mjs` — current Pump claim route and safety gates
- `scripts/operator/automation-mainnet.mjs` and `scripts/operator/automation-payout.mjs` — funding/source acceptance and immutable payout plan
- `packages/db/src/payout-treasury.ts` — reserve, fee capital and full-liability checks

Official Pump documentation:
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COLLECT_CREATOR_FEE.md
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/SWEEP_FEES.md
- https://github.com/pump-fun/pump-fun-skills/blob/main/coin-fees/SKILL.md
