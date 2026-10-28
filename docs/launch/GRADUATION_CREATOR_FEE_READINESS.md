# Creator-fee graduation readiness — review-only preparation

Status: OFFLINE PREPARATION ONLY. No mint is pinned here. No key, wallet mandate, signer, mainnet transaction, environment setting, financial STOP or production process was modified by this preparation.

## Why this matters
The published protected `scripts/operator/automation-claim.mjs` builds only the Pump `collectCreatorFeeV2` instruction and deliberately rejects completed bonding curves and fee-sharing configurations (`CLAIM_TOPOLOGY_REVIEW`). That path must not be enabled for an unsupported post-graduation fee topology.

Official Pump references:
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_CREATOR_FEE_README.md
- https://github.com/pump-fun/pump-fun-skills/blob/main/coin-fees/SKILL.md
- https://www.npmjs.com/package/@pump-fun/pump-sdk

For a direct creator, Pump curve fees live in the Pump creator vault (native SOL), while post-graduation canonical PumpSwap fees live in a separate AMM creator vault (WSOL). Both may hold owed fees across the migration boundary. Fees for fee-sharing and holder-rewards tokens follow different ownership paths. Official SDK descriptions include both collection routes; neither an old claim method nor a single native-SOL balance proves completeness.

## Prepared now
- `scripts/operator/creator-fee-route-readiness.mjs`: an **offline, read-only** classification helper for independently verified SOL-paired direct creator snapshots. It names the pre-graduation and graduated vault sets. It returns HOLD for missing evidence, wrong owner/mint, inconsistent stage, non-canonical pool, sharing, holder rewards and other quote assets. It ALWAYS sets `automaticSigningAuthorized: false`.
- `scripts/operator/creator-fee-route-readiness.test.mjs`: dependency-free focused tests. Run `node --test scripts/operator/creator-fee-route-readiness.test.mjs`.
- No imports into any production financial entrypoint. This does NOT implement new on-chain claim signing or authorize release.

## Minimal future integration, only after the real mint exists
1. Independently confirm mainnet mint, real creator, actual source topology, SOL quote, holder-rewards/sharing state, current curve completion, canonical PumpSwap pool and `coinCreator`. Use finalized corroborated RPC evidence, not UI labels or one stale API response. Fail closed if a source disagrees.
2. Preserve direct Pump native-SOL claim where verified and separately add a PumpSwap canonical WSOL creator-vault collection path using reviewed official SDK/IDL pins. Verify exact token accounts, payer, quote mint, wallet identity, instructions, compute/fee ceiling and resulting on-chain deltas. Account for any required WSOL account creation/rent and conversion; NEVER count WSOL as native SOL before actually received.
3. On graduation, reconcile **both** vaults and their separate finalized claim receipts. Deduplicate canonical per-token fee events and account for claims that aggregate revenue from multiple mint/earning periods. No credit to hourly pools before token and UTC earning-period attribution plus independent financial acceptance.
4. Retain the production design: protected signer enrollment for the verified creator; independent role mandates; STOP-generation binding; source review; original 63/27/10 allocation; daily/buffer holds; treasury reserve and historical escrow; one-time receipts; payout plan snapshot; recipient/fee caps; no uncertain retries.
5. Test both sides of migration, delayed sweeps, stale/failing RPCs, missing/corrupt canonical pool, sharing or holder-rewards toggles, historical liability, duplicate claims, fee over cap, signed transaction recovery, and a no-fee/no-payout hour. Test with disposable infrastructure and keys only. A live production change needs an exact approved protected package.
6. Reconcile the recent operator-financed treasury gas deposit as a finalized `NETWORK_FEES` receipt with exact sender/signature/index and separate approval. It is **not** player revenue. The exact mint-bound token claim and a genuinely funded winner plan are independent acceptance gates.
7. For automatic subsequent hours, obtain reviewed **recurring bounded** authority. A one-hour pilot or a proposed expiry is not standing authorization. Daily payouts remain held unless separately qualified.

## Pending dependencies, not to invent or bypass
- Mint and its independently verified on-chain creator/pool configuration do not exist in this source snapshot.
- The real developer wallet needs protected local signer enrollment; its actual current unrestricted claim gas requires verification.
- The installed Windows operator source and protected configuration may differ from this GitHub publication checkout; reconcile before any deployment.
- Financial STOP/claim/payout channels remain disabled. Do not assert a payout is live until a genuine source/funding/authorization and finalized payout receipt are verified.
