# Local development

Follow README.md. `compose.yml` provisions local PostgreSQL/Redis; its sample password is development-only. Never copy production environment files or database dumps into a contributor checkout.

After `npm ci`, copy `.env.example`, start containers and run `npm run db:migrate`. `npm run dev` starts API, worker and Vite watchers. Built entrypoints are `npm run start:api` and `npm run start:worker`; these are baseline entrypoints, not protected production activation.

Baseline migrations live in `packages/db/migrations` with a committed journal. Candidate SQL and isolated schemas require explicit review. Current-quote work requires disposable linked-route schema prerequisites, four current-quote SQL files and a test-only policy. Never install production grants/profiles to make tests pass.

`npm run test:publication` checks core rules, current-quote router/cutoff behavior and browser security helpers. `npm run test:extension` uses jsdom. Baseline builds do not typecheck every isolated experimental entry; scoped configurations cover those separately. Integration/operational tests may need isolated service ports, frozen historical fixtures or Windows elevation. Report missing fixtures; do not substitute production access.

Operator tools can install tasks, alter custody or perform real financial actions. They are outside contributor setup and CI. Keep execution and ingestion disabled.
