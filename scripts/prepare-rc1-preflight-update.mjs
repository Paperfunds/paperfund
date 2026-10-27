import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { transform } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const frozen = resolve(root, 'releases/extension-rc1/submission');
export const output = resolve(root, 'artifacts/linked-pair-rc1-0.2.1-candidate');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function prepare() {
  const before = await readFile(resolve(frozen, 'content.js'), 'utf8');
  if (sha256(before) !== 'a4f7c9568525b072a1e10fa3da982007ffbf5f8f39630253dd8d0adf590b8c09')
    throw Error('RC1_PREIMAGE_CHANGED');
  const source = await readFile(resolve(root, 'packages/shared/src/browser.ts'), 'utf8');
  const helper = source.slice(
    source.indexOf('export function buyPreflightMessage('),
    source.indexOf('/** Read-only identity metadata'),
  );
  if (
    !helper.startsWith('export function buyPreflightMessage(') ||
    !helper.includes('GENERIC_OPERATOR_ENTRY_DISABLED')
  )
    throw Error('PREFLIGHT_SOURCE_CHANGED');
  const { code } = await transform(
    helper.replace('export function buyPreflightMessage', 'function Et'),
    { loader: 'ts', minify: true, target: 'chrome120' },
  );
  const start = before.indexOf('function Et(e){'),
    end = before.indexOf('function bt(', start);
  if (start < 0 || end < start || before.indexOf('function Et(e){', start + 1) !== -1)
    throw Error('RC1_HELPER_BOUNDARY_CHANGED');
  const after = before.slice(0, start) + code.trim() + before.slice(end);
  await mkdir(output, { recursive: true });
  await cp(frozen, resolve(output, 'submission'), { recursive: true, force: true });
  await writeFile(resolve(output, 'submission/content.js'), after);
  const manifest = JSON.parse(await readFile(resolve(frozen, 'manifest.json'), 'utf8'));
  if (manifest.version !== '0.2.0') throw Error('RC1_VERSION_CHANGED');
  manifest.version = '0.2.1';
  await writeFile(
    resolve(output, 'submission/manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        const name = relative(frozen, path).replaceAll('\\', '/');
        files.push({
          file: name,
          before: sha256(await readFile(path)),
          after: sha256(await readFile(resolve(output, 'submission', name))),
        });
      }
    }
  }
  await walk(frozen);
  if (
    files
      .filter((f) => f.before !== f.after)
      .map((f) => f.file)
      .sort()
      .join(',') !== 'content.js,manifest.json'
  )
    throw Error('UNEXPECTED_PAYLOAD_CHANGE');
  await writeFile(
    resolve(output, 'manifest.json'),
    JSON.stringify(
      {
        version: '0.2.1',
        status: 'PREPARED_NOT_INSTALLED_OR_PUBLISHED',
        scope:
          'Existing source preflight-message correction applied only to frozen RC1 helper; manifest version increment.',
        files,
      },
      null,
      2,
    ) + '\n',
  );
  return { before: before.slice(start, end), after: code.trim(), files };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepare();
  console.log(
    JSON.stringify({
      output,
      changed: result.files.filter((f) => f.before !== f.after).map((f) => f.file),
    }),
  );
}
