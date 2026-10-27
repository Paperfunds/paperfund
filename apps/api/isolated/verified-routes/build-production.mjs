import { build } from 'esbuild';
import { resolve, isAbsolute, dirname, join } from 'node:path';
import { createRequire, builtinModules } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync, existsSync } from 'node:fs';
const output =
  process.argv[2] ?? 'docs/linked-pair-20261023/production-integration/production-routes.mjs';
if (process.argv[2] && existsSync(output)) throw Error('NEW_CANDIDATE_DESTINATION_REQUIRED');
const entry = process.argv[3] ?? 'apps/api/isolated/verified-routes/production-entry.ts';
if (
  !['apps/api/isolated/verified-routes/production-entry.ts', 'apps/api/src/main.ts'].includes(entry)
)
  throw Error('REVIEWED_ENTRY_REQUIRED');
const result = await build({
  entryPoints: [entry],
  outfile: output,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  alias: { '@paperfund/db': resolve('packages/db/src/index.ts') },
  metafile: true,
  plugins: [
    {
      name: 'retain-workspace-runtime-dependencies',
      setup(plugin) {
        plugin.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path === '@paperfund/db') return { path: resolve('packages/db/src/index.ts') };
          if (isAbsolute(args.path)) return;
          if (args.path.startsWith('node:') || builtinModules.includes(args.path))
            return { path: args.path, external: true };
          const require = createRequire(resolve(args.resolveDir, '__isolated_dependency__.cjs'));
          const resolved = require.resolve(args.path);
          // pg's official import entry exposes Pool; its require entry has no detected named export.
          const imported =
            args.path === 'pg' ? resolved.replace(/lib[\\/]index\.js$/, 'esm/index.mjs') : resolved;
          return { path: pathToFileURL(imported).href, external: true };
        });
      },
    },
  ],
});
writeFileSync(
  join(dirname(output), 'bundle-inputs.json'),
  JSON.stringify(result.metafile, null, 2),
);
if (
  Object.values(result.metafile.outputs).some((o) =>
    o.imports.some((i) => i.path === '@paperfund/db' || i.path.includes('/packages/db/dist/')),
  )
)
  throw Error('STALE_COMPILED_DB_IMPORT_FORBIDDEN');
console.log('ISOLATED_SOURCE_BUNDLE_PASS: ' + output);
