# Paperfund multi-terminal extension

## Scope and status

Paperfund provides one Chromium Manifest V3 extension and one shared overlay for Axiom, GMGN.ai, and Terminal / Padre at `trade.padre.gg`. It is a fast paper-trading client for the existing `/api/v1` backend. It does not price tokens, choose Pump.fun versus PumpSwap, sign transactions, submit real trades, or duplicate accounting rules.

## Current Axiom research

Research was performed on **2026-09-25** against the public production application at `https://axiom.trade` without bypassing authentication. The current shipped application source defines Solana trading pages as `/meme/<token mint>` and other-chain trading pages as `/token/<address>`. A public navigation to `/meme/7LSs…pump?chain=sol` preserved that pathname and Axiom added its normal chain-selection query parameters. The public app is a client-side React application and its history/navigation code treats `/meme/` as a trading route.

The stable integration for this phase is therefore:

```text
https://axiom.trade/meme/<32-byte base58 Solana mint>[?chain=sol]
```

An optional final `/@referrer` segment is accepted because Axiom's current routing supports referral suffixes. `/token/` is deliberately rejected because it is currently used for non-Solana chains. No hashed CSS class, token symbol, chart text, or Axiom-displayed name is trusted for identity. The only production host matched is `axiom.trade`.

## Current GMGN and Terminal / Padre research

Research was repeated on **2026-09-29** against the public production products without bypassing authentication. GMGN's canonical host is `gmgn.ai` (`www.gmgn.ai` redirects there), and current Solana token pages use `/sol/token/<mint>`. The path contains the exact mint, and client-side navigation changes that URL, so no DOM fallback or text scraping is required. Other chain prefixes fail closed.

Terminal's current canonical application host is `trade.padre.gg`. Its shipped route manifest defines `/trade/:chain/:marketAddress`; current indexed Solana links and live navigation use `/trade/solana/<mint>`. Pump-family links put the exact 32-byte base58 mint in that slot. `/trenches` can display several token cards simultaneously and is deliberately not treated as one current-token context. Non-trade routes, non-Solana chains, extra path segments, and malformed addresses fail closed. The obsolete `theterminal.trade` host is not matched or permitted. GMGN and Padre are SPAs handled by the shared navigation bridge.

## Architecture

- `TerminalAdapterRegistry` resolves exactly one of `AxiomTerminalAdapter`, `GMGNTerminalAdapter`, and `PadreTerminalAdapter`; duplicate matches throw instead of choosing arbitrarily.
- Each adapter answers only whether its verified page is a supported Solana token context and which valid mint is being viewed. It has no protocol or financial logic.
- The content script creates a fixed host and a **Shadow DOM**, so Paperfund and Axiom styles remain isolated. The host has `pointer-events:none`; only the panel accepts input.
- A small page-world bridge observes `pushState`, `replaceState`, `popstate`, and `hashchange`. A content-world mutation observer is a low-cost fallback for dynamic navigation. There is no full-DOM polling.
- The background service worker is the only extension component that calls Paperfund and the only component that can read the opaque session token.
- The toolbar popup uses the approved Paperfund mark and contains compact session/round status, a full-app link, the overlay enable/disable control, and a reset-layout control. It is not a second trading UI.

The terminal and protocol boundaries remain separate:

```text
terminal adapter -> valid current mint -> Paperfund HTTP API -> backend execution router -> Pump.fun/PumpSwap
```

Each tab owns its adapter and current mint. The service worker owns the extension-wide session but no current-mint variable. The authenticated user's hourly account, cash, slots, positions, and history therefore remain continuous across terminals; visible tabs converge through the existing authoritative polling and post-trade refresh.

## Stale-mint safeguards

Every navigation immediately clears `market`, `preflight`, and the loaded-mint binding. BUY and SELL controls require `terminalMint === loadedMint`. Every asynchronous market/preflight result captures its requested mint and is discarded if the current mint changed before completion. Returning to an unsupported, malformed, non-Solana, or unknown route never retains the previous market. Each click generates a new UUID idempotency key and sends the exact currently bound mint.

## Wallet bridge and authentication

Content scripts cannot safely assume direct access to page-injected wallets, so the local page bridge exposes exactly three operations:

- get connected public key;
- connect;
- sign the exact Paperfund authentication message.

It exposes no arbitrary provider call and no transaction, transfer, approval, or swap signing method. The user must click both **Connect Wallet** and **Sign In to Paperfund**; signatures never trigger automatically.

For extension transport, `/api/v1/auth/verify` accepts the explicit `transport: "extension"` field after the same Ed25519 challenge verification. The returned opaque session token is stored in `chrome.storage.session`, never `localStorage`, never a terminal DOM, and never a page-world message. The service worker adds it as a bearer token and deletes it on logout or expiry. PostgreSQL/Redis authority is unchanged.

`chrome.storage.session` deliberately survives MV3 service-worker suspension but is cleared when the extension is disabled, reloaded, updated, or the browser exits. After worker suspension the next message restarts the worker, reloads the token from session storage, and refetches all round, account, position, market, and activity state. After a browser or extension restart the user signs in again; no financial state is restored from browser storage. An API 401 clears the worker token and returns the overlay to explicit sign-in state without automatically requesting another signature.

## UI, layout, average entry, and polling

The default panel is 376×660 CSS pixels, constrained to 300×320 minimum and 560×820 maximum as the viewport permits. Dragging its header moves it; the lower-right handle resizes it; every update is clamped to an eight-pixel viewport margin. Axiom, GMGN, and Padre each retain independent `x`, `y`, width, height, and collapsed state in `chrome.storage.local`. The popup's **Reset panel layout** removes those preferences and restores the safe default. No balance, position, fill, valuation, market state, or round is trusted from local storage.

The panel shows the UTC round/countdown, cash, executable equity, token slots, backend-resolved venue, exact preflight maximum, current position, partial SELL, SELL ALL, latest activity, and the most recent completed-round result. It is explicitly labeled **Paper trading only**. An open position also shows `PF AVG ENTRY`, calculated only from authoritative remaining cost basis and token quantity. Multiple buys therefore produce a weighted average; proportional partial sells retain the remaining basis average; full exit removes the marker; token navigation clears it immediately.

GMGN currently isolates its financial chart in a blob-backed `iframe` and exposes no supported price-scale API. Logged-out Axiom and Padre do not expose their chart surfaces. Paperfund therefore does not draw an arbitrary price-level line. Where a stable chart container (`iframe[title="Financial Chart"]` or explicit chart test id) is present, a non-interactive `PF AVG` label is anchored next to its top edge and follows resize/scroll; otherwise the same value remains in the current-position panel. This is deliberately a truthful adjacent-chart fallback, not a fake TradingView order or a screen-Y approximation.

Visible tabs poll round/account state every 4.5 seconds, current-token market/preflight every 10 seconds, and activity as part of the account refresh plus after mutations. Polling pauses while the document is hidden and refreshes on return. Server time and persisted round state remain authoritative.

## Manifest and permissions

The generated manifest is version 3 and has a strict `script-src 'self'; object-src 'self'` extension CSP. It loads no remote executable code and uses no `eval`.

Requested permissions:

- `storage`: `chrome.storage.session` for the opaque auth session and `chrome.storage.local` for UI preferences.
- API host permission: the exact origin derived from `PAPERFUND_API_BASE_URL`, needed by the background service worker.
- isolated content-script match plus the small manifest-declared `MAIN`-world bridge: `https://axiom.trade/*`, `https://gmgn.ai/*`, and `https://trade.padre.gg/*`.
- `content.js` and its generated JavaScript chunks are web-accessible only to those same three exact site patterns; this is required for the isolated-world bootstrap's dynamic import and does not expose them on other sites.

It does not request `all_urls`, browsing history, clipboard, downloads, tabs, wallet secrets, or any transaction permission.

## Build configuration

The developer build uses loopback defaults. A release build has no implicit origin and requires both public build-time variables:

| Variable                         | Scope                   | Purpose                                                                 |
| -------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `PAPERFUND_API_BASE_URL`         | PUBLIC BUILD-TIME       | Paperfund API base URL and exact manifest host permission               |
| `PAPERFUND_APP_URL`              | PUBLIC BUILD-TIME       | Full Paperfund web-app URL opened from the overlay/popup                |
| `PAPERFUND_ALLOW_INSECURE_LOCAL` | LOCAL RELEASE TEST ONLY | Allows an explicit loopback HTTP URL while testing the release packager |

Release URLs must otherwise use HTTPS and may not contain credentials or fragments. `SOLANA_RPC_URL`, database credentials, Redis credentials, cookie settings, auth TTLs, rate limits, and all private keys are SERVER-ONLY and must never be passed to Vite or the extension build.

## Build and developer install

```powershell
npm install
npm run build:extension
```

The build emits `apps/extension/build` and generates an API-origin-specific manifest. The manifest key makes the unpacked development ID stable: `lcnpjpkojoadojibfbjfohpjepkfmdln`.

The production package must use exact HTTPS build-time origins and be rebuilt whenever either origin
changes. Add its exact `chrome-extension://lcnpjpkojoadojibfbjfohpjepkfmdln` origin to server CORS.
Inspect the packaged manifest and bundle before distribution: it must contain no RPC URL, database
URL, Redis URL, cookie secret, or signer material. The approved black interlocking PF mark with green
horizontal accent is stored unchanged at `assets/brand/paperfund-mark.png`. Reproducible exports are
generated by `scripts/generate-brand-assets.ps1`; do not redraw, recolor, or replace the source.

Exact developer installation:

1. Run `npm run build:extension`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the generated `apps/extension/build` directory.
6. Open a supported Solana token route on Axiom, GMGN, or Terminal / Padre.
7. Verify that the Paperfund paper-trading overlay identifies the terminal and mint without covering the terminal's main controls.

Use `npm run dev:extension` for watch builds, then click **Reload** for the extension on `chrome://extensions`.

## Release packaging

Set the two public release URLs, then run:

```powershell
$env:PAPERFUND_API_BASE_URL='https://api.example.com'
$env:PAPERFUND_APP_URL='https://app.example.com/trade'
npm run package:extension
```

The command performs a fresh production-mode build; validates exact permissions, host matches, CSP,
icon dimensions, and absence of remote/evaluated code, source maps, fixtures, `node_modules`, local
`.env`, server-secret markers, or signer material; and writes both the clean load-unpacked directory
and `artifacts/paperfund-extension-0.2.0.zip`. The manifest is at the ZIP root and the package and
generated manifest share version `0.2.0`. See `docs/CHROME_WEB_STORE.md` for official requirements,
listing copy, data disclosures, assets, and manual submission gates.

## Tests

For browser tests while the tunnel-backed API is running, set `PAPERFUND_E2E_PORT=3001` and build
the tested client with the matching loopback API URL (`PAPERFUND_API_BASE_URL` for extension or
`VITE_API_BASE_URL` for web) and `PAPERFUND_ALLOW_INSECURE_LOCAL=true`. The test API still binds only
loopback and uses a disposable database. Rebuild manual artifacts with canonical public origins
afterwards. Do not route the public tunnel to the fixture server.

Positions include exact advisory SELL capacity. A liquidity-limited holding shows its max executable
quantity/output and P&L on only that proportionate cost basis. Known-failing presets are disabled;
the exact max action remains available. Full equity/P&L is not invented, and BUY explains when
canonical full-exit portfolio equity cannot be established. See `PHASE_6C_CONTINUATION.md` for
unresolved economic rules and `PROTOCOL_COVERAGE.md` for missing venues.

`npm run test:extension` runs deterministic tests with no terminal, wallet, RPC, or network dependency. Coverage includes all three route contracts, base58 validation, registry ambiguity, SPA navigation and clearing, per-terminal stale-mint races, auth states and expiry, round entry, exact MAX, BUY success/error, executable position display, partial SELL, SELL ALL, rollover, shared-account continuity, three-tab mint isolation, layout bounds, per-terminal preferences, and authoritative average-entry arithmetic. The fixture harness supplies terminal-like navigation states, a message-only wallet, and an in-memory API transport.

`npm run test:extension:headed` builds and loads the actual unpacked MV3 bundle in headed Playwright Chromium. It uses the real local API/database lifecycle with recorded deterministic Pump market state and a test-only message-signing wallet. The acceptance covers the popup, wallet rejection recovery, sign-in, round entry, 10 Paper SOL, authoritative MAX, stale-mint invalidation before submission, BUY, partial SELL, SELL ALL, activity, persisted collapse state, and service-worker termination/restart. It never exposes a transaction-signing method and blocks real Axiom trades by serving an Axiom-origin fixture document.

`npm run test:extension:live` visits current public token routes on Axiom, GMGN, and Terminal / Padre only to verify injection, route compatibility, SPA updates, Shadow DOM isolation, and panel layout. It does not submit any host-terminal trade. By default both headed commands use Playwright's Chromium; `PAPERFUND_CHROMIUM_EXECUTABLE` can select another compatible executable.

Chrome 137 and newer branded builds disable the legacy `--load-extension` switch. For those builds, set `PAPERFUND_CDP_LOAD_UNPACKED=true` together with `PAPERFUND_CHROMIUM_EXECUTABLE`; the harness uses Chrome's browser-scoped `Extensions.loadUnpacked` DevTools command in its temporary profile.

## Live compatibility findings (2026-09-29)

Terminal identity does not affect protocol support: Axiom `/meme/<mint>`, GMGN `/sol/token/<mint>`, and Padre `/trade/solana/<mint>` all submit the same mint to the same Paperfund market endpoint. Current mainnet RPC reads and the public API produced this matrix:

| Mint / symbol            | Current on-chain context                                         | Paperfund result                        | Root cause / expectation                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BxS9…pump` / LOADPAD    | completed Pump curve → canonical SOL PumpSwap pool `66eZ…4CGU`   | supported, `PUMP_SWAP`, migrated pool   | Previously reached the correct resolver/adapter but PostgreSQL rejected an untyped parameter while saving migration metadata; fixed with an explicit text cast. |
| `KdML…ZEC` / ZECOS       | active SOL Pump.fun bonding curve `3Eih…5wcY`                    | supported, `PUMP_FUN`, active curve     | Expected support; no resolver, RPC, or decoder failure.                                                                                                         |
| `FxMH…pump` / TariffaDon | completed Pump curve → canonical SOL PumpSwap pool `3MtU…QMBN`   | supported, `PUMP_SWAP`, migrated pool   | Same migrated-market SQL defect as LOADPAD; fixed.                                                                                                              |
| `36sa…wfUQ` / PINKY      | Raydium pool `3UYi…Cmic`, paired with DJT; no Pump bonding curve | unsupported, `MARKET_ACCOUNT_NOT_FOUND` | Genuinely outside the current Pump.fun/PumpSwap execution boundary.                                                                                             |

The SQL defect explains the reproduced migrated-market API failures, but it does **not** prove the cause of the operator's Axiom/GMGN discrepancy. Synthetic same-mint routes reach the same endpoint; authenticated Axiom navigation remains unverified. Axiom/Padre market-address routes must not be assumed universally to contain a token mint. This remains a live acceptance gate, not a resolved parser finding. Transient RPC codes remain unavailable and are not converted to unsupported.

Six additional current GMGN trending mints were sampled. Four were canonical SOL PumpSwap routes and supported (`3TzH…8DxQ`, `49aM…1Cd9`, `A71U…pump`, `4JYB…pump`); one was a non-Pump Raydium/RKLB route (`9KTN…YJ4D`) and one a Meteora/SOL route (`G6Qd…BAGS`), both correctly unsupported. Result: 4 supported, 2 unsupported, 0 temporary errors. Together with the supplied active ZECOS fixture, the sample covers active Pump, migrated PumpSwap, Raydium, and Meteora. This is evidence for Pump-origin compatibility, not a claim that all Solana terminal tokens are supported; Raydium and Meteora remain material launch-coverage gaps.

## Failure and recovery behavior

- RPC, timeout, protocol-disabled, and authoritative-state failures display **Market data temporarily unavailable. Retrying…** and retain safe polling. A missing Pump origin or explicitly unsupported migration displays **This token's market is not supported by Paperfund yet.** Trade controls remain disabled until current state is successfully refetched.
- Wallet connection and message-signature rejection return control to the user. No signature request repeats automatically.
- Invalid signatures and expired sessions return to explicit sign-in. A successful later sign-in recovers normally.
- A route or mint change clears the old market/preflight binding synchronously. A stale TOKEN_A action cannot submit after navigation to TOKEN_B.
- Round ID changes clear prior account, position, and preflight state. Reloads refetch all financial state from the API.

## Known limitations

- Axiom may require authentication to render its full terminal. Public route/source inspection verified the integration contract, but automated tests use fixtures.
- Padre's shipped route is `/trade/:chain/:marketAddress`; the adapter currently accepts the Solana base58 route candidate. Real authenticated pool-address versus mint-address behavior still needs validation. A pool candidate does not pass the backend's mint-based Pump eligibility checks; no arbitrary pool execution is enabled.
- No token metadata is scraped from any terminal. The current API returns mint, decimals, support, and venue but not authoritative symbol/name metadata.
- Final DNS/TLS, publisher identity, monitored support email, privacy/legal approval, production screenshots, and Chrome Web Store account verification remain operator-controlled release gates.
- No WebSocket, automatic Chrome Web Store publishing, Firefox support, or fourth terminal is included.

### Evidence boundaries and protocol review (2026-09-30)

Current official [Pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json), [Pump AMM IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_amm.json), and [fee IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_fees.json) were compared with the existing decoders. Program IDs, discriminators, curve reserve/complete/creator fields, quote-mint fields, pool base/quote/vault fields, virtual quote reserves, creator fee fields, and SOL fee-tier prefixes match. The adapters deliberately accept SOL quote mechanics only; stable/exotic quote fee schedules are not covered. No execution math was changed. Captures at confirmed slot `451815648` now test both supplied migrated curves/pools and the active KdML curve.

The PINKY pool and extra `9KTN…YJ4D` pool are owned by Raydium CPMM `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`; the `G6Qd…BAGS` pool is owned by Meteora DAMM v2 `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`. These were primary on-chain owner reads, not mint-suffix inference. Supporting them requires their own validated reserve/fee/Token-2022 execution models; non-SOL quotes also need an explicit quote conversion model. Six non-random trending samples are insufficient to estimate market-wide coverage. Two of six falling outside scope is a material launch-coverage warning, not proof that a new adapter should be added in this corrective phase.

The current `@live` suite proves injection into real pages and synthetic History API notifications only. It does not prove host-driven navigation, authenticated token context, paper BUY/SELL, or correctly positioned chart-price lines. Axiom redirected to its logged-out landing page; Padre required sign-in. GMGN rendered the LOADPAD page and its Financial Chart iframe, but no authenticated Paperfund live trading was performed. All three real trading/marker acceptance scenarios therefore remain unverified. The in-panel entry and optional chart-edge label are denominated in SOL/token, not USD and not a price-scale line.
