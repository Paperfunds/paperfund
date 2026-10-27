import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, hash } from './common.mjs';
const manifest = JSON.parse(
  await readFile(resolve(ROOT, 'docs/operator-candidate/manifest.json'), 'utf8'),
);
const failures = [];
for (const file of [...manifest.files, ...manifest.dependencies]) {
  if (file.path.startsWith('/') || file.path.includes('..') || file.path.includes(':'))
    throw Error('INVALID_MANIFEST_PATH');
  try {
    if (hash(await readFile(resolve(ROOT, file.path))) !== file.sha256) failures.push(file.path);
  } catch {
    failures.push(file.path);
  }
}
if (failures.length) {
  console.error(JSON.stringify({ verified: false, failures }));
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      verified: true,
      files: manifest.files.length,
      dependencies: manifest.dependencies.length,
      scope: 'INTEGRITY_ONLY_NOT_FINANCIAL_AUTHORIZATION',
    }),
  );
