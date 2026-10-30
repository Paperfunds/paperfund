# Paperfund Night — website + extension rebrand

Status: **DRAFT — NOT DEPLOYED**. Visual design implementation based on the owner's selected dark-violet mockups, prepared without changing the trading engine or financial authorizations.

## Scope
- Website light brand overrides replaced by final dark-violet CSS layer (`apps/web/src/paperfund-night.css`).
- Landing page uses two **vector illustrations** of the approved concept, explicitly labeled illustrative/not live. They are not generated screenshots and do not imply fabricated metrics are live. The original user-approved image mockups are design reference, not source assets embedded here.
- Website competition page adds a desktop **sidebar linking to existing routes**. It does not create new endpoints, trade actions, metrics or payout features. The existing header/nav still works; sidebar is hidden on small screens.
- Extension keeps every current overlay component, BUY/SELL controls, quote calculation, chart markers, terminal adapters, wallet auth and API URLs unchanged. Its content and popup styles get dark-purple visual overrides.
- Extension toolbar PNG icons (16/32/48/128) regenerated to match the shared simplified purple P. Stable Web Store key and extension identity unchanged.

## No fictional feature claims
The reference images contain invented P&L, trader names, deposits, charts and reward totals. The deployed application MUST render ONLY actual API data and verified reward status. Never substitute design-illustration values into production. No sidebar search, new performance metrics, new leaderboards or additional overlay tabs were added.

## Verification
1. Reconcile this branch with installed Windows production sources and any subsequent local financial disclosure fixes. GitHub PR base is PR #5 (which is based on PR #4), and `main` may lag Windows.
2. Run targeted build and tests: `npm run build`, `npm run build:extension`, `npm run test:extension`, `npm run test:publication`; and focused Rewards web tests. Record PASS/FAIL without broad unexplained tests.
3. Manual website smoke at desktop and mobile widths: home, hourly/daily, trade, history, rewards, rules/privacy, supported wallet authentication. Check actual reward signal remains truthful and note financial STOP if asserted.
4. Deploy **website assets only** to existing HTTPS host using approved procedure; do not restart or modify the API, worker, or financial host controls. Verify live HTTP and routes, with no CORS/origin changes.
5. Separately load the newly built extension as an **unpacked candidate** and smoke-test Axiom, GMGN.ai and Padre: correct detected market, BUY, partial SELL, SELL ALL, 20% cap, 5-token entry rule, cross-terminal shared positions, persistence/reload and chart markers. Use PAPER trades only and trusted production-safe accounts.
6. Confirm Chrome package identity, manifest, permissions and source-version manifest. Preserve published extension ID/key. Publish a **new Chrome Web Store version** only after manual acceptance. A GitHub branch or Vite build is not a Store release.
7. If a smoke check fails, rollback the visual release. Never patch trading or bypass auth to compensate during this task.

## Operational and finance boundary
No database migrations, signer changes, payouts, fee-split changes, worker restarts, STOP releases or financial approvals. Real-SOL payout status comes from API evidence and must remain visible if unavailable. Marketing illustrations must not be confused with actual payment receipts.

## Publishing dependencies
This chat cannot access the user's **local Windows deployment** or their **Chrome Web Store developer dashboard** directly. Those two releases require authorized operator action, plus installation/publishing checks. No promise of live status until independently verified after deployment.
