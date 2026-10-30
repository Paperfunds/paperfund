# Public-facing copy and real screenshot gallery — 2026-10-30

This draft is visual/content-only. It is **not** proof that real-SOL payouts are active. Reward accounting still reflects the actual API's payments state.

## Product copy
- Website landing, navigation and app notice no longer use private beta, preview release, signer-enrollment or token activation language.
- The competition mechanics (Paper SOL, rankings, rewards funding and buffer) remain accurately described.
- Rewards page still reads backend evidence and shows SOL payouts **unavailable** or **available** according to the real payment status. No pretending the financial STOP has been removed.

## Higher-quality authentic extension screenshots
The landing page references two new authentic browser screenshot crops:
- `apps/web/public/extension-axiom-hq.webp` — source: actual Axiom + Paperfund screenshot from 2026-10-26, 600 x 746, SHA256 `1f657b6e62fc08762fda518de7773db7993c256bd32aa7e63e5bd773b9e8757c`
- `apps/web/public/extension-gmgn-hq.webp` — source: actual GMGN + Paperfund screenshot from 2026-10-26, 616 x 760, SHA256 `7210fd678ebbfa0d40f92e4c1b70db6f6b619eca9b8b89f989a7d97622fff2bf`

These are clean crops from real browser captures, not AI-generated trading interfaces. The original screenshots show the older extension skin, which is not altered in this website-only PR. Both WebP files are **committed directly to this GitHub branch** and their byte-for-byte Git blob hashes match the original files. The original screenshot fallbacks remain as resilience if a future deployment omits the new files.

**Before live deployment**: pull both committed images with the branch, verify hashes above, reconcile against newer protected local content and run focused web tests/build. The public site's real payout-status state must not be hidden or falsely represented as active. Do not touch extension, API, worker, signer, or financial STOP. Reuse website-only deployment. Inspect browser page and images after publication.

Chrome extension rebranding is a separate release, not part of this website-only copy task.
