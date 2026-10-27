# Protected automation rollout

This is a staged automation component. No existing financial STOP, source contract, signer account, legacy claim journal, RC1 or trading implementation is changed. Installation does not grant transaction authority.

## What runs and what remains blocked

The read-only observer scans the existing payout/STOP summaries. The protected service, once separately deployed, runs under the existing non-administrator PaperfundSigner account via a limited Windows startup task. The dashboard is a command client; it never holds a key. Private scheduling, reservations and audit events live under the signer's existing DPAPI-isolated profile. Financial commands are requests; only the protected service can acknowledge them. UI states come from the acknowledged persisted state, not the requested toggle.

Claims use the existing official collect_creator_fee_v2 instruction, validate creator/mint/vault ownership, obtain a fresh blockhash, estimate the exact fee, simulate, check the signed standing policy, check financial STOP and its generation, reserve the policy budget, sign through DPAPI, persist signed bytes/signature, submit once, and reconcile finalized message plus exact account deltas. The aggregate receipt is always REVIEW and is never automatically credited as token reward capital. The instruction sweeps current creator-vault excess; gross caps are preflight eligibility limits, not an on-chain amount argument. Unexpected receipt amounts remain REVIEW and block subsequent work.

The HH:59 UTC schedule coalesces missed hours into one current observation. It never reuses a stale signed candidate or replays old hourly transactions. A provider failure before reservation can retry after one minute. A signed or uncertain transaction is reconciled only; no automatic resend or replacement occurs. Expired absence remains REVIEW pending independent resolution. A durable orphan signed artifact is recovered by signature. A reservation with no artifact is conclusively unsubmitted by this pipeline and retained as ABORTED_NOT_SUBMITTED. Reserved budget remains conservatively counted.

Hourly/daily planning remains owned by the existing deployed worker: finalization, 60-second grace, approved curves, ties, buffer, zero-participant handling and immutable pinned recipients are not duplicated. The automation core can dispatch qualified existing plans and enforces shared daily/outstanding/recipient/transaction/fee budgets. The adapter calls the existing approve/execute/reconcile contracts and retains their separation of approver and executor. It cannot synthesize APPROVE authority.

IMPORTANT: the deployed accepted legacy source contract and production trigger support TEST_ONLY_LOCALNET, not a real mainnet ACCEPTED profile. No qualified mainnet authorization/treasury backend exists in this installation. The service therefore deliberately has no enrolled payout backend and marks every current real plan REVIEW. Automatic mainnet payout execution is BLOCKED until a separately reviewed mainnet source/funding bootstrap and separate authority issuers are genuinely installed. A standing policy, a current RPC response or passing fixture tests cannot override that missing financial contract.

## One-time deployment (not a standing mandate)

After specific deployment approval, run the reviewed install-automation.ps1 with -RegisterService -ProvisionReadOnlyDatabase from an elevated local PowerShell. The installer preserves unknown existing components/accounts/tasks; it does not reset passwords, remove journals, grant administrator membership or release STOP. It creates one restricted SELECT-only PostgreSQL login for payout_stop_state and payout_plans. Its credential is confined to an administrator-owned config readable only by the signer, administrators and SYSTEM. Windows-account password entry is local and hidden; Task Scheduler retains its password-logon credential for startup without interactive login. Registration uses Limited privileges and IgnoreNew, with restart-on-failure supervision.

## One-time secure custody and mandate enrollment

The exposed GHMG burner key is categorically rejected by standing-policy validation. It remains available only to the old separately authorized interactive testing workflow. No exposed key is copied or loaded here.

1. Explicitly run the installed open-automation-custody.ps1 locally to generate a fresh signer key and CurrentUser DPAPI encrypted backup under PaperfundSigner. This action is optional and is not run by installation. Only the public address is displayed. No transaction authority or creator-authority change is implied.
2. Enroll that public wallet with installed enroll-automation-custody.ps1 -Wallet PUBLIC_ADDRESS in elevated local PowerShell. Old custody records are preserved. DPAPI remains bound to the Windows identity/profile; account password resets or profile loss can invalidate recovery. The backup is encrypted under the same existing identity, not a portable independent recovery guarantee.
3. The current mint's creator is still the compromised GHMG wallet. Fresh custody does NOT silently move that authority. Production automatic claiming remains blocked by the mint/creator binding until a secure, separately approved creator configuration exists. No creator migration was attempted by this implementation.
4. Export a public draft through the dashboard. Enter the exact fresh wallet/mint, financial and emergency STOP generations, independent claim/hourly/daily limits and a future expiry (maximum seven days). Draft limits start at zero and all permissions start disabled. No money-moving authority is inferred from prior expired exact approvals.
5. Run installed authorize-automation.ps1 -Draft PUBLIC_DRAFT_PATH elevated. It validates and displays the entire scope, then requires the phrase APPROVE STANDING MAINNET. Its Windows CNG RSA policy signing key is non-exportable, readable only by administrators/SYSTEM, and unavailable to the signer/API/worker. The signer only verifies the pinned public certificate. Old signed policies are preserved. The certificate is not a wallet key.
6. Release no financial STOP until genuine approved financial acceptance conditions are met. The implementation itself never releases it. Enable each channel through the dashboard only after its independent gate passes.

Revocation: installed authorize-automation.ps1 -Revoke -PolicyId ID. Emergency dashboard STOP immediately leaves a stop marker and latches a private generation increment. Restart does not clear it. Resuming requires a new signed policy bound to that generation with resumeAutomationStop=true; global financial STOP is independent and remains mandatory.

## Controls

Claim Fees Now queues one uniquely identified protected request. Auto Claim controls only the HH:59 fee-claim channel. Hourly and Daily controls only their respective qualified-plan dispatch. Requests do not update ON/OFF indicators until the signer has persisted acknowledgment. OFF does not remove an uncertain transaction. Reconcile is read-only with respect to chain/signing and remains permitted without an active grant. All finalized signatures link to mainnet Explorer. A stale service heartbeat is displayed as STALE_NO_NEW_SIGNING, not RUNNING.

## Validation evidence

Targeted automation tests cover signed mandate tampering/revocation/expiry, compromised-key exclusion, UTC edges, durable request deduplication, caps, STOP after signing, provider backoff, lost ACK, restart/reconcile and tampered/truncated audit records. Separate disposable cryptographic tests sign only newly generated offline keys and verify exact receipt arithmetic. Windows CNG non-exportability/signature acceptance is tested with a disposable certificate/key that is removed. A live read-only mainnet simulation matches the pre-existing canonical message; no key is opened and no transaction is sent. Browser acceptance verifies the real controls remain OFF and cannot bypass absent enrollment.

Local audit records have signed hash links and signed anchors; this detects edits and ordinary tail truncation. It does not claim hardware-backed anti-rollback protection against a full host administrator or an entire-disk snapshot rollback. External signed checkpoint retention is required for that stronger threat model.

## Verified disabled deployment — 20 October 2026

The approved installation is running under PaperfundSigner with Limited privileges and Password startup logon. All three channels remain OFF, standing authority is NONE, and the database financial STOP remains asserted. The console was restarted; the API and worker were not restarted by this deployment. The next scheduled check at verification was 2026-10-20T14:59:00.000Z; OFF means it cannot claim.

Deployment validation corrected two startup issues: the SDK is now included using its CommonJS entry in the service bundle, and the account has only the required batch-logon right added. A restart test exposed an orphan Node child; the host now uses a Windows kill-on-close job for its child. The repeated real task restart passed, retained the signed audit head and rejected enable request, and left no orphan. Existing unrelated logon rights, passwords, account membership, claim journals and wallet records were preserved. Historical startup-error files are retained as evidence.

Live browser acceptance verifies Running, OFF controls, asserted STOP, blocked direct signing and cross-origin controls. The ordinary API/worker identity cannot open the signer private audit record or protected database configuration. Installed manifest hashes and all 14 RC1 files match. See artifacts/operator/automation-acceptance.json and automation-live-acceptance.json, plus C:\ProgramData\PaperfundSignerAcceptance\automation-live-restart.public.json. No wallet was generated and no mainnet transaction was signed or broadcast.
