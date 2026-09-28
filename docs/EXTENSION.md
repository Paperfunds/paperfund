# Paperfund multi-terminal extension

## Scope and status

Phase 5B provides one Chromium Manifest V3 extension and one shared Paperfund overlay for Axiom, GMGN.ai, and Terminal.trade. It is a fast paper-trading client for the existing `/api/v1` backend. It does not price tokens, choose Pump.fun versus PumpSwap, sign transactions, submit real trades, or duplicate accounting rules.

## Current Axiom research

Research was performed on **2026-09-25** against the public production application at `https://axiom.trade` without bypassing authentication. The current shipped application source defines Solana trading pages as `/meme/<token mint>` and other-chain trading pages as `/token/<address>`. A public navigation to `/meme/7LSs…pump?chain=sol` preserved that pathname and Axiom added its normal chain-selection query parameters. The public app is a client-side React application and its history/navigation code treats `/meme/` as a trading route.

The stable integration for this phase is therefore:

```text
https://axiom.trade/meme/<32-byte base58 Solana mint>[?chain=sol]
```

An optional final `/@referrer` segment is accepted because Axiom's current routing supports referral suffixes. `/token/` is deliberately rejected because it is currently used for non-Solana chains. No hashed CSS class, token symbol, chart text, or Axiom-displayed name is trusted for identity. The only production host matched is `axiom.trade`.

## Current GMGN and Terminal research

Research was repeated on **2026-09-27** against the public production products without bypassing authentication. GMGN's canonical host is `gmgn.ai` (`www.gmgn.ai` redirects there), and current Solana token pages use `/sol/token/<mint>`. The path contains the exact mint, and client-side navigation changes that URL, so no DOM fallback or text scraping is required. Other chain prefixes fail closed.

Terminal's canonical application host is `www.theterminal.trade` (`theterminal.trade` redirects there). Its current application route manifest and live navigation use `/token/<mint>?network=solana`; Discover and global search navigate to that route. `/trenches` can display several token cards simultaneously and is deliberately not treated as one current-token context. Non-token routes, missing/other networks, and malformed mints fail closed. Both applications are SPAs handled by the shared navigation bridge.

## Architecture

- `TerminalAdapterRegistry` resolves exactly one of `AxiomTerminalAdapter`, `GMGNTerminalAdapter`, and `TerminalTradeAdapter`; duplicate matches throw instead of choosing arbitrarily.
- Each adapter answers only whether its verified page is a supported Solana token context and which valid mint is being viewed. It has no protocol or financial logic.
- The content script creates a fixed host and a **Shadow DOM**, so Paperfund and Axiom styles remain isolated. The host has `pointer-events:none`; only the panel accepts input.
- A small page-world bridge observes `pushState`, `replaceState`, `popstate`, and `hashchange`. A content-world mutation observer is a low-cost fallback for dynamic navigation. There is no full-DOM polling.
- The background service worker is the only extension component that calls Paperfund and the only component that can read the opaque session token.
- The toolbar popup contains status, a full-app link, and the overlay enable/disable control. It is not a second trading UI.

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

## UI and polling

The bottom-right panel shows the UTC round/countdown, cash, executable equity, token slots, backend-resolved venue, exact preflight maximum, current position, partial SELL, SELL ALL, latest activity, and the most recent completed-round result. It is explicitly labeled **Paper trading only**. Collapse and enable preferences live in `chrome.storage.local`; no balance, position, fill, valuation, or round is trusted from local storage.

Visible tabs poll round/account state every 4.5 seconds, current-token market/preflight every 10 seconds, and activity as part of the account refresh plus after mutations. Polling pauses while the document is hidden and refreshes on return. Server time and persisted round state remain authoritative.

## Manifest and permissions

The generated manifest is version 3 and has a strict `script-src 'self'; object-src 'self'` extension CSP. It loads no remote executable code and uses no `eval`.

Requested permissions:

- `storage`: `chrome.storage.session` for the opaque auth session and `chrome.storage.local` for UI preferences.
- API host permission: the exact origin derived from `PAPERFUND_API_BASE_URL`, needed by the background service worker.
- isolated content-script match plus the small manifest-declared `MAIN`-world bridge: `https://axiom.trade/*`, `https://gmgn.ai/*`, and `https://www.theterminal.trade/*`.
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
horizontal accent is not present as a binary in the repository; do not approximate it. Supplying and
exporting the exact approved asset from `assets/brand/paperfund-mark.svg` at 16, 32, 48, and 128
pixels is a launch checklist gate.

Exact developer installation:

1. Run `npm run build:extension`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the generated `apps/extension/build` directory.
6. Open a supported Solana token route on Axiom, GMGN, or Terminal.
7. Verify that the Paperfund paper-trading overlay identifies the terminal and mint without covering the terminal's main controls.

Use `npm run dev:extension` for watch builds, then click **Reload** for the extension on `chrome://extensions`.

## Release packaging

Set the two public release URLs, then run:

```powershell
$env:PAPERFUND_API_BASE_URL='https://api.example.com'
$env:PAPERFUND_APP_URL='https://app.example.com/trade'
npm run package:extension
```

The command performs a fresh production-mode build, verifies that the artifact contains no source maps, fixtures, `node_modules`, local `.env`, RPC variable, or obvious private-key/seed references, and writes the clean load-unpacked directory to `artifacts/paperfund-extension-0.1.0`. The package and generated manifest share version `0.1.0`.

## Tests

`npm run test:extension` runs deterministic tests with no terminal, wallet, RPC, or network dependency. Coverage includes all three route contracts, base58 validation, registry ambiguity, SPA navigation and clearing, per-terminal stale-mint races, auth states and expiry, round entry, exact MAX, BUY success/error, executable position display, partial SELL, SELL ALL, rollover, shared-account continuity, and three-tab mint isolation. The fixture harness supplies terminal-like navigation states, a message-only wallet, and an in-memory API transport.

`npm run test:extension:headed` builds and loads the actual unpacked MV3 bundle in headed Playwright Chromium. It uses the real local API/database lifecycle with recorded deterministic Pump market state and a test-only message-signing wallet. The acceptance covers the popup, wallet rejection recovery, sign-in, round entry, 10 Paper SOL, authoritative MAX, stale-mint invalidation before submission, BUY, partial SELL, SELL ALL, activity, persisted collapse state, and service-worker termination/restart. It never exposes a transaction-signing method and blocks real Axiom trades by serving an Axiom-origin fixture document.

`npm run test:extension:live` visits current public token routes on Axiom, GMGN, and Terminal only to verify injection, route compatibility, SPA updates, Shadow DOM isolation, and panel layout. It does not connect a wallet or submit any terminal or Paperfund trade. By default both headed commands use Playwright's Chromium; `PAPERFUND_CHROMIUM_EXECUTABLE` can select another compatible executable.

Chrome 137 and newer branded builds disable the legacy `--load-extension` switch. For those builds, set `PAPERFUND_CDP_LOAD_UNPACKED=true` together with `PAPERFUND_CHROMIUM_EXECUTABLE`; the harness uses Chrome's browser-scoped `Extensions.loadUnpacked` DevTools command in its temporary profile.

## Failure and recovery behavior

- API, Redis/session, RPC, and authoritative market failures are displayed as typed unavailable/error states. Trade controls remain disabled until current state is successfully refetched.
- Wallet connection and message-signature rejection return control to the user. No signature request repeats automatically.
- Invalid signatures and expired sessions return to explicit sign-in. A successful later sign-in recovers normally.
- A route or mint change clears the old market/preflight binding synchronously. A stale TOKEN_A action cannot submit after navigation to TOKEN_B.
- Round ID changes clear prior account, position, and preflight state. Reloads refetch all financial state from the API.

## Known limitations

- Axiom may require authentication to render its full terminal. Public route/source inspection verified the integration contract, but automated tests use fixtures.
- Terminal `/trenches` is a multi-card feed rather than a single current-token page; Paperfund activates only on `/token/<mint>?network=solana`.
- No token metadata is scraped from any terminal. The current API returns mint, decimals, support, and venue but not authoritative symbol/name metadata.
- The approved black interlocking PF mark with green horizontal accent was not present in the repository, so binary logo wiring is deferred rather than inventing an asset.
- No WebSocket, drag positioning, Chrome Web Store publishing, Firefox support, or fourth terminal is included.
