# Chrome Web Store release

This is Paperfund's operator checklist and store-listing source of truth. Requirements were checked
against Google's official documentation on **2026-09-28**:

- [Prepare an extension](https://developer.chrome.com/docs/webstore/prepare)
- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)
- [Listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Image requirements](https://developer.chrome.com/docs/webstore/images)
- [Program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [User data policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Quality and single-purpose guidance](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines)
- [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3) and
  [remote-hosted-code guidance](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)

Requirements can change. Recheck these pages immediately before submission.

## Listing copy

**Name:** Paperfund

**Single purpose:** Paperfund adds a paper-trading competition overlay to supported Solana trading
terminals.

**Short description:** Paper-trading competition overlay for Axiom, GMGN.ai, and Terminal.trade.

**Full description:**

> Paperfund adds a compact simulated-trading competition overlay to supported Solana token pages on
> Axiom, GMGN.ai, and Terminal.trade. Enter each hourly round with 10 Paper SOL, inspect an
> authoritative maximum order, place simulated buys and sells, monitor positions and executable
> equity, and review activity without leaving the terminal. Paper SOL and simulated positions have
> no monetary value. Paperfund never signs or submits terminal transactions and never asks for a
> seed phrase or private key. Creator-fee-funded reward allocations are real only after operator
> approval, on-chain payment, and reconciliation.

## Permissions and executable-code review

| Access               | Exact scope                                                                     | Why it is needed                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `storage`            | Extension session and preferences                                               | Keeps the opaque login session in `chrome.storage.session` and enable/collapse preferences in `chrome.storage.local`. |
| API host             | The one origin supplied as `PAPERFUND_API_BASE_URL`                             | Lets the background worker call Paperfund's authenticated API.                                                        |
| Content matches      | `https://axiom.trade/*`, `https://gmgn.ai/*`, `https://www.theterminal.trade/*` | Detects a supported Solana token URL and renders the overlay.                                                         |
| Web-accessible files | Paperfund content bundle, chunks, and mark; same three matches only             | Boots the isolated Shadow DOM overlay on those hosts.                                                                 |

There is no `all_urls`, tabs/history, clipboard, downloads, notifications, wallet-secret, transaction,
or analytics permission. Manifest V3, a service worker, local-only extension CSP, and release
validation prohibit remote executable code, `eval`, and `new Function`.

## Data-use disclosure inventory

| Data                                                                 | Location/recipient                               | Purpose                                       | Retention/status                                               |
| -------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------- |
| Public wallet address and explicit auth-message signature            | Paperfund API/database; signature is verified    | Authenticate address control                  | Final retention schedule requires legal/operator approval.     |
| Opaque extension session                                             | `chrome.storage.session`                         | Authenticated API access                      | Ends with browser/extension session; cleared on logout/expiry. |
| Enable/collapse preferences                                          | `chrome.storage.local`                           | Remember UI choices                           | Until cleared or extension removal.                            |
| Supported terminal hostname and current Solana mint                  | Current tab and Paperfund API                    | Bind the overlay to the intended paper market | No page-content scraping or browsing-history collection.       |
| Competition entries, simulated trades, positions, results            | Paperfund API/PostgreSQL                         | Operate and audit the competition             | Financial/audit retention requires final policy approval.      |
| Reward allocations and verified payouts                              | Paperfund API/PostgreSQL and public Solana chain | Approve, pay, and reconcile rewards           | On-chain records are public and durable.                       |
| Timestamp, request route/status, network address, operational errors | Hosting/logging infrastructure                   | Security, abuse prevention, reliability       | Final log retention requires operator approval.                |

Paperfund does not access seed phrases or private keys, request arbitrary wallet calls, sign
transactions, or obtain custody of user funds. The current implementation contains no ads, referral
tracking, third-party analytics, sale of personal data, or sharing for targeted advertising.
Infrastructure categories are application hosting, PostgreSQL-compatible database hosting,
Redis-compatible session storage, and Solana RPC. Complete the Dashboard privacy questionnaire so it
matches this table exactly.

## Images and screenshots

Checked-in assets:

- store icon: `assets/chrome-web-store/icon-128.png` (128×128 PNG; mark kept inside the recommended
  transparent safe area);
- required small promo tile: `assets/chrome-web-store/small-promo-440x280.png`;
- optional marquee: `assets/chrome-web-store/marquee-1400x560.png`;
- manifest icons: 16, 32, 48, and 128 px PNGs.

Capture 1280×800 PNG or JPEG screenshots from deterministic fixtures with no real wallet address,
session token, private terminal account, or secret. Google requires at least one and allows up to
five; use all five when they remain legible:

1. Axiom: authenticated round/equity and clear simulated label.
2. GMGN.ai: current token plus BUY/MAX preflight.
3. Terminal.trade: position, partial SELL, and SELL ALL.
4. Three-tab continuity/isolation or collapsed state without terminal obstruction.
5. Completed result and truthful reward-allocation state.

The headed fixture can deterministically capture five development-only candidates without live
financial activity:

```powershell
$env:PAPERFUND_STORE_SCREENSHOT_DIR='artifacts/store-screenshots'
$env:PAPERFUND_CHROMIUM_EXECUTABLE='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:PAPERFUND_CDP_LOAD_UNPACKED='true'
npm run test:extension:headed
```

It captures popup, Axiom preflight, Axiom position/SELL, GMGN, and Terminal states at 1280×800 and
hides the deterministic fixture wallet row in authenticated screenshots. These are review aids, not
automatically approved store artwork; recapture after final production-origin validation and select
at most five.

Do not paste explanatory text into screenshots that implies unsupported behavior. Review every image
at its uploaded size.

## URLs and owner-supplied release gates

Planned production URLs (not claimed live or DNS-verified):

- homepage: `https://paperfundapp.com`
- web app: `https://app.paperfundapp.com`
- API: `https://api.paperfundapp.com`
- privacy: `https://paperfundapp.com/privacy`
- rules: `https://paperfundapp.com/rules`
- support: `https://paperfundapp.com/support`

Before building or submitting, the operator must:

1. Supply and verify DNS/TLS for every used origin and decide whether public routes live on the root
   or app subdomain.
2. Supply the publisher/legal entity, jurisdiction, monitored support email, and privacy contact.
   **No support email is currently approved; do not invent one.**
3. Obtain legal review of the privacy notice, retention schedule, user-rights language, reward
   claims, and store listing.
4. Enroll the publisher in the Chrome Web Store developer dashboard, pay any current registration
   fee, enable required account security, and complete any current identity/trader verification shown
   by the dashboard.
5. Build with the real HTTPS API/app origins, configure exact server CORS for the published extension
   ID, and repeat the full acceptance suite.
6. Capture and review the five production-quality screenshots above using test data.

## Build, audit, and upload

```powershell
$env:PAPERFUND_API_BASE_URL='https://api.paperfundapp.com'
$env:PAPERFUND_APP_URL='https://app.paperfundapp.com/trade'
npm run package:extension
```

The command performs a fresh production build, validates the manifest, icon dimensions, exact
permissions/matches, CSP, absence of source maps/fixtures/environment files/secret markers, and
absence of obvious remote/evaluated code. It creates:

- `artifacts/paperfund-extension-0.2.0/` for final unpacked inspection;
- `artifacts/paperfund-extension-0.2.0.zip` with `manifest.json` at the ZIP root.

Load the unpacked directory in a clean Chrome profile and rerun headed acceptance. Inspect the ZIP
contents and hashes, then upload the ZIP in the developer dashboard. Complete Store Listing,
Privacy, Distribution, and Test Instructions. Explain wallet message-signing, fixture account setup,
and how reviewers reach each supported terminal route. Use deferred publication if a coordinated
launch is required. Do not publish until every gate above is complete. For updates, bump the manifest
package version, rebuild from source, validate, test, and upload the new ZIP; never patch an artifact.
