# GitHub server-side cleanup request

Prepared for the repository owner to send to GitHub Support. No support message has been sent automatically.

Repository: `Paperfunds/paperfund` (PRIVATE).

We have completed an authorized history rewrite of our existing repository to remove third-party host-code excerpts with no established redistribution permission and historical fixed E2E signing credentials. Current tests generate ephemeral keys. A verified recovery bundle is retained privately. No production credential exposure was confirmed, and these historical test keys must never be used for custody.

Please remove cached views, obsolete references and server-side access to the removed original history, and advise whether additional references or forks need remediation before we can safely change visibility to public.

Original main before rewriting: `b6d3e62a85db519360287da30558959472f2b0b7`.

Removed from historical commits:

- Entire `releases/extension-rc1/` archive, including acquired `evidence/module-783515.js` and `evidence/module-812024.js`.
- Historical `e2e/browser-flow.spec.ts` and `e2e-extension/headed-extension.spec.ts` versions containing fixed test signing material. Clean current versions are restored in the new main.

After the leased rewrite, authenticated GitHub Contents API requests still returned HTTP 200 for:

- `releases/extension-rc1/evidence/module-783515.js` at original commit `b6d3e62a85db519360287da30558959472f2b0b7`.
- `e2e/browser-flow.spec.ts` at original commit `0fb797e18dcf4df9fb879273f60a92c92fd93f26`.

Do not include file contents, signing values, credentials or private recovery bundles in a public issue. Provide any additional original commit/object identifiers only through the private support channel as requested. Keep this repository private until GitHub confirms cleanup and old object access is independently rechecked.
