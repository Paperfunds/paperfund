import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionPackage = JSON.parse(
  readFileSync(join(root, 'apps', 'extension', 'package.json'), 'utf8'),
);
const target = resolve(process.argv[2] ?? join(root, 'apps', 'extension', 'build'));
const expectedTerminals = [
  'https://axiom.trade/*',
  'https://gmgn.ai/*',
  'https://www.theterminal.trade/*',
];

if (!existsSync(target)) throw new Error(`Extension artifact does not exist: ${target}`);
const manifestPath = join(target, 'manifest.json');
if (!existsSync(manifestPath)) throw new Error('manifest.json must be at the artifact root.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const apiUrl = process.env['PAPERFUND_API_BASE_URL'];
if (!apiUrl) throw new Error('PAPERFUND_API_BASE_URL is required for release validation.');
const expectedApiPermission = `${new URL(apiUrl).origin}/*`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function sameStrings(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}
function filesUnder(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(path));
    else result.push(path);
  }
  return result;
}
function pngDimensions(path) {
  const bytes = readFileSync(path);
  assert(bytes.subarray(1, 4).toString('ascii') === 'PNG', `${path} is not a PNG.`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

assert(manifest.manifest_version === 3, 'The store artifact must use Manifest V3.');
assert(manifest.name === 'Paperfund', 'Unexpected extension name.');
assert(manifest.version === extensionPackage.version, 'Manifest/package versions differ.');
assert(
  typeof manifest.description === 'string' && manifest.description.length <= 132,
  'Manifest description must be present and no longer than 132 characters.',
);
assert(sameStrings(manifest.permissions, ['storage']), 'Permissions must contain only storage.');
assert(
  sameStrings(manifest.host_permissions, [expectedApiPermission]),
  `Host permissions must contain only ${expectedApiPermission}.`,
);
assert(
  manifest.content_security_policy?.extension_pages === "script-src 'self'; object-src 'self'",
  'Unexpected extension-page CSP.',
);
for (const script of manifest.content_scripts ?? []) {
  assert(sameStrings(script.matches, expectedTerminals), 'Content-script matches are not exact.');
}
for (const resource of manifest.web_accessible_resources ?? []) {
  assert(sameStrings(resource.matches, expectedTerminals), 'Web-accessible matches are not exact.');
}
assert(!JSON.stringify(manifest).includes('<all_urls>'), 'all_urls is forbidden.');

for (const size of [16, 32, 48, 128]) {
  const icon = join(target, manifest.icons?.[size]);
  assert(existsSync(icon), `Missing ${size}px icon.`);
  const [width, height] = pngDimensions(icon);
  assert(width === size && height === size, `Icon ${size} is ${width}x${height}.`);
}

const forbiddenPaths = [
  /\.map$/i,
  /(^|[\\/])node_modules([\\/]|$)/i,
  /(^|[\\/])\.env/i,
  /fixture/i,
];
const secretMarkers = /SOLANA_RPC_URL|DATABASE_URL|REDIS_URL|PRIVATE_KEY|SEED_PHRASE|COOKIE_SECRET/;
const remoteCode =
  /<script[^>]+src=["']https?:|import\s*\(\s*["']https?:|\beval\s*\(|\bnew\s+Function\s*\(/i;
const files = filesUnder(target);
for (const path of files) {
  const name = relative(target, path);
  assert(
    !forbiddenPaths.some((pattern) => pattern.test(name)),
    `Forbidden artifact entry: ${name}`,
  );
  if (['.js', '.json', '.html', '.css'].includes(extname(path).toLowerCase())) {
    const content = readFileSync(path, 'utf8');
    assert(!secretMarkers.test(content), `Potential server secret marker in ${name}.`);
    assert(!remoteCode.test(content), `Potential remote/evaluated code in ${name}.`);
  }
}

console.log(`Validated ${files.length} release files for Paperfund ${manifest.version}.`);
console.log(
  `Permissions: storage; host: ${expectedApiPermission}; terminals: ${expectedTerminals.length}.`,
);
