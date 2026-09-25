import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionDirectory = join(root, 'apps', 'extension');
const extensionPackage = JSON.parse(readFileSync(join(extensionDirectory, 'package.json'), 'utf8'));
const buildDirectory = join(extensionDirectory, 'build');
const outputDirectory = join(root, 'artifacts', `paperfund-extension-${extensionPackage.version}`);

for (const name of ['PAPERFUND_API_BASE_URL', 'PAPERFUND_APP_URL']) {
  if (!process.env[name]) throw new Error(`${name} is required to package the extension.`);
}

const npmCli = process.env['npm_execpath'];
if (!npmCli) throw new Error('Run this packager through npm run package:extension.');
execFileSync(
  process.execPath,
  [npmCli, 'run', 'build:release', '--workspace', '@paperfund/extension'],
  { cwd: root, env: process.env, stdio: 'inherit' },
);

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });
cpSync(buildDirectory, outputDirectory, { recursive: true });

const forbidden = [/\.map$/i, /(^|[\\/])node_modules([\\/]|$)/i, /(^|[\\/])\.env/i, /fixture/i];
const files = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else files.push(path);
  }
}
collect(outputDirectory);
for (const path of files) {
  const relative = path.slice(outputDirectory.length + 1);
  if (forbidden.some((pattern) => pattern.test(relative))) {
    throw new Error(`Forbidden release artifact entry: ${relative}`);
  }
  if (/\.(?:js|json|html|css)$/i.test(path)) {
    const text = readFileSync(path, 'utf8');
    if (/SOLANA_RPC_URL|PRIVATE_KEY|SEED_PHRASE/.test(text)) {
      throw new Error(`Potential server secret reference in ${relative}`);
    }
  }
}

console.log(`Packaged ${files.length} files in ${basename(outputDirectory)}`);
