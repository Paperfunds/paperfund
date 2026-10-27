import { build } from 'esbuild';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
for (const n of ['service', 'policy-check', 'configure', 'provision', 'mainnet-tools'])
  await build({
    entryPoints: [
      n === 'mainnet-tools'
        ? 'scripts/operator/mainnet-tools.mjs'
        : 'scripts/operator/automation-' + n + '.mjs',
    ],
    bundle: true,
    plugins: [
      {
        name: 'bundle-pump-commonjs',
        setup(builder) {
          builder.onLoad({ filter: /(?:automation-claim|receipts)\.mjs$/ }, async ({ path }) => ({
            contents: fs
              .readFileSync(path, 'utf8')
              .replace(
                "createRequire(import.meta.url)('@pump-fun/pump-sdk')",
                "require('@pump-fun/pump-sdk')",
              ),
            loader: 'js',
          }));
        },
      },
    ],
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    define: { 'import.meta.url': JSON.stringify('file:///C:/PaperfundSigner/library.mjs') },
    outfile:
      n === 'mainnet-tools'
        ? 'scripts/operator/mainnet-tools.bundle.cjs'
        : 'scripts/operator/automation-' + n + '.bundle.cjs',
  });
fs.copyFileSync(
  'packages/db/migrations/0018_mainnet_source_acceptance.sql',
  'scripts/operator/mainnet-source-acceptance.sql',
);
const names = [
  'mainnet-tools.bundle.cjs',
  'mainnet-source-acceptance.sql',
  'review-mainnet-evidence.ps1',
  'automation-service.bundle.cjs',
  'automation-policy-check.bundle.cjs',
  'automation-configure.bundle.cjs',
  'automation-provision.bundle.cjs',
  'automation-host.ps1',
  'automation-dpapi.ps1',
  'authorize-automation.ps1',
  'open-automation-custody.ps1',
  'enroll-automation-custody.ps1',
  'grant-automation-batch.ps1',
];
const files = names.map((name) => ({
  name,
  sha256: createHash('sha256')
    .update(fs.readFileSync('scripts/operator/' + name))
    .digest('hex'),
}));
fs.writeFileSync(
  'scripts/operator/automation-install-manifest.json',
  JSON.stringify(
    { schema: 'paperfund-disabled-automation-install-v1', authority: 'NONE', files },
    null,
    2,
  ) + '\n',
);
console.log(
  'Automation-only artifacts and reviewed installation hashes prepared. No installed component changed.',
);
