import { build } from 'esbuild';
import { resolve, isAbsolute } from 'node:path';
import { createRequire, builtinModules } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const output = 'docs/linked-pair-20261021/verified-route-integration/verified-routes.mjs';
const result = await build({
  entryPoints: ['apps/api/isolated/verified-routes/entry.ts'],
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
          return { path: pathToFileURL(require.resolve(args.path)).href, external: true };
        });
      },
    },
  ],
});
writeFileSync(
  'docs/linked-pair-20261021/verified-route-integration/bundle-inputs.json',
  JSON.stringify(result.metafile, null, 2),
);
if (
  Object.values(result.metafile.outputs).some((o) =>
    o.imports.some((i) => i.path === '@paperfund/db' || i.path.includes('/packages/db/dist/')),
  )
)
  throw Error('STALE_COMPILED_DB_IMPORT_FORBIDDEN');
console.log('ISOLATED_SOURCE_BUNDLE_PASS: ' + output);
