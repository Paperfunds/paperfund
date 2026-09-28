import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionDirectory = join(root, 'apps', 'extension');
const extensionPackage = JSON.parse(readFileSync(join(extensionDirectory, 'package.json'), 'utf8'));
const buildDirectory = join(extensionDirectory, 'build');
const outputDirectory = join(root, 'artifacts', `paperfund-extension-${extensionPackage.version}`);
const zipPath = `${outputDirectory}.zip`;

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

execFileSync(
  process.execPath,
  [join(root, 'scripts', 'validate-extension-release.mjs'), outputDirectory],
  {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  },
);
rmSync(zipPath, { force: true });
execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(root, 'scripts', 'compress-extension.ps1'),
    '-SourceDirectory',
    outputDirectory,
    '-DestinationPath',
    zipPath,
  ],
  { cwd: root, stdio: 'inherit' },
);

console.log(`Packaged ${basename(outputDirectory)} and ${basename(zipPath)}`);
