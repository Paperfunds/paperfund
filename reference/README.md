# Current production source references

Readable TypeScript and composition modules in `apps`, `packages` and `scripts` include approved subsequent corrections. The frozen public API was assembled from an earlier subset; seven pinned inputs differ from current working files.

For inspection of actual deployed behavior, `production-api` preserves its first-party JavaScript runtime source, and `production-worker/worker.mjs` preserves the October 27 DURABLE_QUOTE_V2 worker. The latter matches deployed SHA256 `8bdd3457dbf9971a09eeb2722e21bcaa26600f6caea45d37483a9650bc48765b`. No v5 worker is substituted for the current worker.

These deliberately retained source references contain first-party code only. Dependency code, environment profiles, custody configuration and operational receipts are excluded. Three API reference files replace a historical PAPER account identifier with a synthetic identifier. Original/published hashes appear in `docs/publication/production-source-reference.json`.

Relative imports refer to the original frozen layout. These references support inspection and provenance; do not launch them against production. Use the baseline contributor setup. Frozen packaging requires separately reviewed dependencies/configuration and is not a public deployment recipe.
