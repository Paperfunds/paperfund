# Paperfund website-first migration — controlled acceptance plan

**Goal:** Retire the Chrome extension as a user requirement, not remove the functioning extension or risk changing protected production. The website at `trade.paperfund.app` becomes the primary market discovery, simulated order, portfolio, and competition interface.

## Existing production backend reused
The website already uses existing authenticated endpoints:
- `/api/v1/auth/challenge`, `verify`, `me`, `logout`;
- `/api/v1/rounds/current` and `/enter`;
- `/api/v1/markets/:mint` and `/api/v1/trades/buy-preflight?mint=`;
- `/api/v1/trades/buy`, `/api/v1/trades/sell`, `/api/v1/positions`;
- trade history, hour/day leaderboards, reward allocation and verified payout evidence.

No new endpoint, money movement, fee qualification, payee authorization, slippage change, backend quote engine or worker restart is part of this branch.

## Features in this branch
1. `/trade` is the default trade-domain route and has a top-level navigation item.
2. Public market discovery by name/symbol is display-only and uses a third-party DexScreener search endpoint; direct mint entry works independently. The list is **not proof of safe listing or Paperfund execution support**.
3. A selected valid Solana mint is shareable via `/trade?mint=...`. Inputs are validated before routing them to API/third-party URLs.
4. An optional DexScreener embedded chart resolves a pair from a valid mint. It is informational and does not affect pricing, entry limits, position valuation or settlement. It is NOT a native authoritative chart feed. The UI displays a clear fallback and an external chart link when metadata/iframe is unavailable.
5. The existing server-authoritative OrderTicket, account balances, available sell percentages, Sell All, positions and trade history remain the same actual components. Layout only places a chart next to the ticket and positions below.
6. Users may browse markets/charts before wallet login; authenticated buying still requires a current-round PAPER account.
7. The marketing landing page explains web-native trading rather than installing the Chrome extension.

## Acceptance gates (BEFORE public rollout)
- Reconcile with latest Windows website source, retaining all new daily payout disclosures, privacy rules and existing operator safeguards. Never overwrite with the older GitHub branch as a whole.
- CI: frontend TypeScript/build and focused unit tests. Local: browser smoke on Chromium, mobile/desktop responsiveness, visually inspect empty/error/loading states.
- Critical workflow: unsigned visitor market lookup; connect wallet; enter UTC round; inspect same mint from direct URL; BUY 0.01 PAPER; refresh; partial SELL; SELL ALL; cross-session persistence, chart display fail-safe; previous result and positions; correct 5-token and 20%-equity limits.
- Check dozens of diverse real mainnet mint types: Pump.fun bonding curves, PumpSwap graduated pools, Orca/other supported routes, non-SOL quotes or route switches, existing positions. Website **must not silently reduce backend token-route coverage** from prior terminal-based eligibility.
- Confirm no sign/transaction prompts for actual token trading. Website wallet auth message signing remains unchanged.
- External market API can fail independently; it must NEVER block a direct-mint Paperfund trade when the actual backend route is qualified and open. Any external dataset conflicts with backend status must not override backend.
- Preserve financial STOP, actual SOL reward holding status, protected reserve and creator-fee eligibility. Do not mark payouts active or redistribute any funds.
- Keep published Chrome extension running as-is for existing users until website trade parity is accepted. Do not submit any new extension version and do not remove its integration endpoints prematurely.

## Known gaps to address before calling this full terminal parity
- DexScreener public search and chart providers are independent, rate-limited third-party services; browser CORS/widget restrictions and pair selection can cause chart absence. Direct mint/authoritative paper execution is unaffected.
- This does not implement a native indexer, orderbook, fully integrated chart trade markers or on-site trending feed. It does not prove coverage of *all* Axiom/GMGN/Padre tradeable tokens. The supported route backend and its qualification remain unchanged.
- The existing competitive leaderboard data is preserved; the illustrated design's invented win rates, USD P&L, rank counts, and wallet aliases are not copied into the functional site.

## Shipping
- Website source only. No extension build/package/release, backend, worker, database, signer or protected financial configuration update.
- GitHub PR is a review artifact; the current public Windows site is unchanged until an approved separate website-only deploy.
