# Proposed history remediation — owner approval required

Repository: `https://github.com/Paperfunds/paperfund.git`. Verified remote main before synchronization: `b6d3e62a85db519360287da30558959472f2b0b7`. No remote tags, other branches, releases or Actions workflows existed at initial review.

## Findings

The reachable history contains two acquired GMGN host modules under `releases/extension-rc1/evidence`. Their redistribution permission is not established. The archive also contains obsolete generated browser output and an archived test depending on those excerpts. Removing only the current files does not remove historical copies.

Two E2E test paths contain a fixed Ed25519 PKCS8 signing key in historical versions. These are test credentials, not evidence of a production key. The current source is changed to generate ephemeral test keys. Every historical fixed key must be treated as public and never funded; retire/rotate any external use if it ever occurred. No production signing credential was confirmed by the scans performed.

## Exact proposed operation

1. Keep the repository private and create a verified offline bundle backup of all existing refs, with private access only.
2. In a separate disposable mirror, remove `releases/extension-rc1/` from every historical commit. Remove the two historical E2E paths (`e2e/browser-flow.spec.ts`, `e2e-extension/headed-extension.spec.ts`) from earlier commits and restore their sanitized current implementations in the final source commit. Retain all other useful original source history, subject to a fresh confidentiality scan.
3. Scan every rewritten reachable blob, nested archive and branch/tag; verify absence of the removed GMGN object content, fixed test signing material and confidential data. Verify complete current source, Apache-2.0, notices and builds/tests remain present. Produce an old-to-new commit map for review.
4. Only after those checks, update the existing remote main with an explicit expected-old-SHA lease. No unconditional force push, new GitHub repository or production deployment. If the remote changes, stop and reconcile; do not overwrite another contributor's work.
5. Ask GitHub Support about purging cached obsolete objects/commit views where needed. A rewritten branch alone does not certify deletion of server caches, pull-request refs, clones or backups. Keep private until accessible remote history and permissions are cleared.
6. Verify the final remote commit and source tree. Public visibility is a separate final gate after confidentiality, third-party licensing and deployed-source provenance verification.

This file is a proposal. No history rewrite or forced update has been executed. Approval must cover rewriting the existing main history and the leased forced update; it does not authorize custody, financial actions, service restarts or deployment.
