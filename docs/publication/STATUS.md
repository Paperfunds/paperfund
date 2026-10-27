# Source synchronization and public-release gate

Repository: https://github.com/Paperfunds/paperfund — keep PRIVATE until the final gate clears.

## Included source

Extension 0.2.2, website/API/worker, current executable quotes, provider/token/routing/fee/valuation logic, ledger/migrations, UTC scoring/ranks, reward allocations/Buffer, durable cutoff settlement, creator-fee/platform/treasury accounting, STOP/approval/payout/recovery algorithms, tests and operator tooling are included. Actual deployed first-party API and current DURABLE_QUOTE_V2 worker references accompany the latest TypeScript.

Excluded: credentials/profiles, keys/vaults, private deployment diary, production backups, logs/receipts, dependency trees, generated browser ZIP/build copies and obsolete RC1 archive. The unlicensed protocol IDL fixture is externalized with its integrity pin and a fail-closed missing-file condition. Historical PAPER account identifiers in the one-time exception are consistently replaced by synthetic identifiers in this publication checkout only.

## Validation

Baseline API/worker/shared TypeScript and website build pass. Development/public-origin extension builds pass. All 13 non-manifest files match the approved keyless extension 0.2.2 ZIP; the manifest differs by the development public identity key. Extension tests: 218 passed. Focused core/current-quote/cutoff/security tests: 217 passed. Full financial/integration suites and production deployment were not run.

Apache-2.0 is owner-approved for original code; branding is separately reserved. GMGN excerpts have no established redistribution permission and are excluded. Dependencies retain their licenses; no Apache-only claim is made over dependency bundles.

## History and confidentiality

Initial reachable history contained 1,026 unique blobs across local refs, fixed historical E2E signing keys and acquired GMGN modules. Pattern/known-environment-value checks found no confirmed production credential. Public manifest identity keys and dummy RPC strings are not private credentials. Historical E2E signing material is retired by ephemeral keys and requires history removal. Any external use of those fixed keys must be retired/rotated.

The owner approved the scoped rewrite and force-with-lease update. See HISTORY_REMEDIATION.md. Recovery backups remain private. Final scan results and rewritten commit verification are recorded separately when complete.

## Remaining public gate

A rewritten main does not prove GitHub removed obsolete objects or cached commit/raw views. Check old sensitive/unlicensed paths after rewriting; if GitHub still serves them, request server-side cleanup through GitHub Support and keep private until verified. Rewriting cannot erase prior clones/backups. Do not make this repository public merely because its new branch tip is clean.
