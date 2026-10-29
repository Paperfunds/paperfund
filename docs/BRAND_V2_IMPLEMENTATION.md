# Paperfund brand v2 — draft implementation

## Approved direction
- Apple-like **light minimal** marketing surface, using whitespace, accurate product copy, charcoal typography and restrained violet drawn from the owner's chosen P profile graphic.
- Competition pages inherit the same white/grey/violet presentation; ranking, prize evidence and UTC mechanics remain the existing components and APIs.
- Extension remains the EXACT SAME interface and behavior: no component layout, Buy/Sell implementation, quote handling, chart markers, auth, route adapters or backend logic was changed in this branch. `content.tsx` and `popup.tsx` CSS color tokens only; `overlay.tsx` only icon path; `vite.config.ts` adds one static icon to the existing whitelist. Icon, banner and brand treatment are independent of extension behavior.
- Brand symbol on web and overlay/popup is `paperfund-mark-v2.svg`. It is a clean simplified **vector adaptation** of the owner-selected metallic purple P (not an exact pixel copy); if exact visual equality is required, replace the visual asset separately after review.

## Screenshots — required local binary assets before deploying
The landing page intentionally loads these real cropped screenshots (not fabricated UI):
- `apps/web/public/extension-axiom-real.webp`
- `apps/web/public/extension-gmgn-real.webp`

Both real Axiom and GMGN screenshot files are committed directly to this GitHub branch as WebP images (compressed 200px-wide crops of existing installed-extension screenshots). They can now be pulled directly into the Windows checkout; no ZIP download is required for the **website-only** deployment. Chrome toolbar PNG icons remain a separate extension-release task and are NOT needed for the website-only deployment. Do not modify or ship the extension in this website rollout.

The actual screenshot crops show the old-branded Paperfund extension; capture replacement screenshots only AFTER the new style is manually smoke-tested on Axiom/GMGN/Padre. Do not fabricate a purported product screenshot.

## External links
- Official GitHub: `https://github.com/Paperfunds/paperfund`.
- X/Twitter: current `siteConfig.xUrl` is empty, so the header shows X only after its exact official URL is provided and configured. Do not invent or redirect an unverified profile.

## Financial correctness
- Normal split: 63% hourly, 27% daily, 10% platform.
- Buffer accumulation mode: 58% hourly, 5% buffer, 27% daily, 10% platform. An hour with zero eligible winners sends its player-designated amount to buffer.
- Real-SOL payouts remain a separate financial system: the landing page correctly describes the reward MODEL and tells visitors payouts are currently on HOLD. No payment-state bypass.
- No production deployment, payout activation or alteration of STOP.

## Merge/deploy review
This branch is based on `fix/public-trading-copy-reward-state-20261028` (PR #2): it deliberately includes the site messaging already deployed on Windows. **Reconcile the Windows installed source to this branch before using its patch**. Never overwrite the actual more recent protected production tree with an older GitHub checkout. Apply only frontend files and static assets, review diffs, use focused build plus extension/website tests, and manually smoke-test the layout on supported terminals at desktop/mobile widths. Keep financial API and workers untouched. Extension rebranding is a separate Chrome Web Store release, not automatically updated by a website deploy.
