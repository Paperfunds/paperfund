/** Explicit offline-reference bootstrap. No npm install, dependency/lock change or server config. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = resolve('node_modules/.cache/paperfund-stage1-reference');
const metadata = await fetch('https://registry.npmjs.org/@pump-fun/pump-swap-sdk/2.1.0').then((r) =>
  r.json(),
);
const packed = Buffer.from(await fetch(metadata.dist.tarball).then((r) => r.arrayBuffer()));
const expected =
  'sha512-O0ulb5In/pMzxpcWIkzU17N27HQNZhGGof4fhgXZUkRj/vDbrZsDrViNoouhR52bvtfRf61e/bSvEg/h+35ueA==';
if ('sha512-' + createHash('sha512').update(packed).digest('base64') !== expected)
  throw Error('Pinned reference integrity mismatch');
mkdirSync(root, { recursive: true });
const archive = gunzipSync(packed);
for (let i = 0; i + 512 <= archive.length;) {
  const h = archive.subarray(i, i + 512),
    name = h.subarray(0, 100).toString().replace(/\0.*$/s, ''),
    size = parseInt(h.subarray(124, 136).toString().replace(/\0.*$/s, ''), 8) || 0,
    type = String.fromCharCode(h[156]);
  if (!name) break;
  const out = resolve(root, name);
  if (!out.startsWith(root + sep)) throw Error('Unsafe archive path');
  if (type === '0' || type === '\0') {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, archive.subarray(i + 512, i + 512 + size));
  }
  i += 512 + Math.ceil(size / 512) * 512;
}
console.log('Pinned SDK 2.1.0 reference extracted to ignored cache; production SDK unchanged.');
