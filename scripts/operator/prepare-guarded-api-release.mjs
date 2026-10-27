// Artifact preparation/verification ONLY. No startup, process control, migrations or config writes.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { root, hash, verifyOriginal, manifestPath } from '../website-artifact-release.mjs';
const assert = (v, e) => {
  if (!v) throw Error(e);
};
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const slash = (p) => p.replaceAll('\\', '/');
const put = (p, b) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, b);
};
const copy = (a, b) => put(b, fs.readFileSync(a));
const inside = (base, p) => p.startsWith(base + path.sep);
const admission = path.join(root, 'docs/linked-pair-20261023/buy-admission');
const releaseRoot = path.join(root, 'docs/website-redesign/deployment-prep/artifact-releases');
const workspaceNames = ['config', 'core', 'execution', 'protocols', 'shared'];
function inventory(directory) {
  const files = [],
    links = [];
  function walk(dir) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name),
        relative = slash(path.relative(directory, p));
      if (d.isSymbolicLink()) {
        const target = fs.realpathSync(p);
        assert(inside(directory, target), 'EXTERNAL_RELEASE_LINK:' + relative);
        links.push({ path: relative, target: slash(path.relative(directory, target)) });
      } else if (d.isDirectory()) walk(p);
      else if (relative !== 'release.json') files.push({ path: relative, sha256: hash(p) });
    }
  }
  walk(directory);
  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    links: links.sort((a, b) => a.path.localeCompare(b.path)),
  };
}
function resolvePackage(from, name) {
  const require = createRequire(path.join(from, '__release_resolution__.cjs'));
  for (const base of require.resolve.paths(name) ?? []) {
    const candidate = path.join(base, name, 'package.json');
    if (fs.existsSync(candidate)) return fs.realpathSync(path.dirname(candidate));
  }
  return null;
}
export function prepareGuardedRelease(destination) {
  const original = verifyOriginal();
  destination = path.resolve(destination);
  assert(
    inside(releaseRoot, destination) && !fs.existsSync(destination),
    'NEW_PROTECTED_RELEASE_REQUIRED',
  );
  const review = read(path.join(admission, 'review-manifest.json'));
  for (const input of review.sourceInputs)
    assert(
      hash(path.join(root, input.path)) === input.sha256,
      'REVIEWED_SOURCE_CHANGED:' + input.path,
    );
  const runtime = path.join(destination, 'runtime'),
    packages = new Map(),
    edges = [],
    absent = [];
  const mapped = (source) => {
    source = fs.realpathSync(source);
    assert(inside(root, source), 'DEPENDENCY_OUTSIDE_REPOSITORY');
    return path.join(runtime, path.relative(root, source));
  };
  fs.mkdirSync(runtime, { recursive: true });
  // Keep exact pinned libraries, excluding stale DB/API dist. No old entry is deployable here.
  for (const name of workspaceNames) {
    const prefix = 'packages/' + name + '/';
    const files = [...original.files, ...original.acceptedSources].filter(
      (f) =>
        f.path.startsWith(prefix) &&
        (f.path.includes('/dist/') || f.path.endsWith('/package.json')),
    );
    assert(
      files.some((f) => f.path.endsWith('/dist/index.js')),
      'PINNED_WORKSPACE_INCOMPLETE:' + name,
    );
    for (const f of files) copy(path.join(root, f.path), path.join(runtime, f.path));
    const alias = path.join(runtime, 'node_modules/@paperfund', name);
    fs.mkdirSync(path.dirname(alias), { recursive: true });
    fs.symlinkSync(path.join(runtime, 'packages', name), alias, 'junction');
  }
  function freeze(source) {
    source = fs.realpathSync(source);
    if (packages.has(source)) return;
    const manifest = read(path.join(source, 'package.json'));
    assert(manifest.name !== '@paperfund/db', 'STALE_DB_DEPENDENCY_FORBIDDEN');
    const target = mapped(source),
      workspace = manifest.name?.startsWith('@paperfund/');
    if (workspace)
      assert(
        workspaceNames.includes(manifest.name.split('/')[1]),
        'UNREVIEWED_WORKSPACE_DEPENDENCY',
      );
    packages.set(source, {
      path: slash(path.relative(destination, target)),
      name: manifest.name,
      version: manifest.version,
    });
    if (!workspace) {
      function tree(from, to) {
        for (const d of fs.readdirSync(from, { withFileTypes: true })) {
          if (['node_modules', '.git'].includes(d.name)) continue;
          const a = path.join(from, d.name),
            b = path.join(to, d.name);
          assert(!d.isSymbolicLink(), 'PACKAGE_LINK_REQUIRES_REVIEW:' + manifest.name);
          if (d.isDirectory()) tree(a, b);
          else copy(a, b);
        }
      }
      tree(source, target);
    }
    const dependencies = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    for (const name of dependencies) {
      if (builtinModules.includes(name) || name.startsWith('node:')) continue;
      const dependency = resolvePackage(source, name);
      if (!dependency) {
        const optional =
          name in (manifest.optionalDependencies ?? {}) ||
          (name in (manifest.peerDependencies ?? {}) &&
            manifest.peerDependenciesMeta?.[name]?.optional);
        assert(optional, 'REQUIRED_DEPENDENCY_MISSING:' + manifest.name + ':' + name);
        absent.push({ from: manifest.name, name });
        continue;
      }
      edges.push({
        from: slash(path.relative(destination, target)),
        name,
        to: slash(path.relative(destination, mapped(dependency))),
      });
      freeze(dependency);
    }
  }
  for (const name of workspaceNames) freeze(path.join(root, 'packages', name));
  const bundles = [
    {
      source: path.join(admission, 'restoration-api/main.mjs'),
      metadata: path.join(admission, 'restoration-api/bundle-inputs.json'),
      output: 'runtime/main.mjs',
      expected: review.entrySHA256,
    },
    {
      source: path.join(admission, 'production-routes.mjs'),
      metadata: path.join(admission, 'bundle-inputs.json'),
      output: 'runtime/production-routes.mjs',
      expected: '5a3bf18d43a8c21b638be86eca3e69be1d8dabd4b5e2c3c7e915f3e43e833b5e',
    },
  ];
  const bundleRecords = [];
  for (const b of bundles) {
    assert(hash(b.source) === b.expected, 'REVIEW_BUNDLE_CHANGED');
    let text = fs.readFileSync(b.source, 'utf8');
    const imports = [
        ...new Set(
          Object.values(read(b.metadata).outputs).flatMap((o) =>
            o.imports.filter((i) => i.path.startsWith('file:')).map((i) => i.path),
          ),
        ),
      ],
      replacements = [];
    for (const url of imports) {
      const source = fileURLToPath(url);
      let pkg = path.dirname(source);
      while (!fs.existsSync(path.join(pkg, 'package.json'))) {
        assert(inside(root, pkg), 'IMPORT_PACKAGE_UNRESOLVED');
        pkg = path.dirname(pkg);
      }
      freeze(pkg);
      const target = mapped(source);
      assert(
        fs.existsSync(target) && hash(target) === hash(source),
        'EXTERNAL_IMPORT_NOT_FROZEN:' + slash(path.relative(root, source)),
      );
      let relative = slash(path.relative(path.dirname(path.join(destination, b.output)), target));
      if (!relative.startsWith('.')) relative = './' + relative;
      assert(text.includes(JSON.stringify(url)), 'IMPORT_RELOCATION_NOT_EXACT');
      text = text.split(JSON.stringify(url)).join(JSON.stringify(relative));
      replacements.push({ original: url, relative, sha256: hash(target) });
    }
    assert(!text.includes('file:///'), 'HOST_BOUND_IMPORT_REMAINS');
    put(path.join(destination, b.output), text);
    bundleRecords.push({
      path: b.output,
      originalSHA256: b.expected,
      sha256: hash(path.join(destination, b.output)),
      replacements,
    });
    copy(
      b.metadata,
      path.join(
        destination,
        'provenance',
        path.basename(path.dirname(b.source)) + '-bundle-inputs.json',
      ),
    );
  }
  for (const name of ['schema.sql', 'partial-settlement.sql', 'quarantine.sql'])
    copy(
      path.join(root, 'packages/db/isolated/linked-pair', name),
      path.join(destination, 'review-only/mixed-schema', name),
    );
  copy(
    path.join(admission, 'review-manifest.json'),
    path.join(destination, 'provenance/admission-review.json'),
  );
  copy(path.join(root, manifestPath), path.join(destination, 'provenance/original-api-build.json'));
  copy(
    path.join(root, 'docs/linked-pair-20261023/PRODUCTION_INTEGRATION.md'),
    path.join(destination, 'review-only/PRODUCTION_INTEGRATION.md'),
  );
  const origin = read(
    path.join(root, 'docs/website-redesign/deployment-prep/api-origin-preparation.json'),
  );
  assert(hash(origin.configFile) === origin.preparedSha256, 'PROTECTED_CONFIG_CHANGED');
  const config = read(origin.configFile);
  for (const [k, v] of Object.entries({
    PRIVATE_BETA_NON_PAYING: 'true',
    PAYOUT_EXECUTION_ENABLED: 'false',
    BETA_INVITE_ONLY: 'true',
    PAYOUT_SIGNER_TYPE: 'DISABLED',
  }))
    assert(config[k] === v, 'UNSAFE_CONFIG:' + k);
  const receipt = {
    schema: 'paperfund-guarded-api-release-v1',
    createdAt: new Date().toISOString(),
    destination,
    status: 'PREPARED_NOT_DEPLOYED_REQUIRES_REVIEW',
    entry: 'runtime/main.mjs',
    composition: 'runtime/production-routes.mjs',
    defaultBuyAdmission: 'DENY_ALL_BUY',
    installedEntryAuthorizer: false,
    mixedBootstrapInstalled: false,
    originalRuntimeFiles: original.files.length,
    originalEntrySHA256: original.entrySha256,
    configFile: origin.configFile,
    configSHA256: origin.preparedSha256,
    node: {
      version: process.version,
      executable: process.execPath,
      sha256: hash(process.execPath),
    },
    sourceInputs: review.sourceInputs,
    bundles: bundleRecords,
    packages: [...packages.values()],
    dependencyEdges: edges,
    absentOptionalDependencies: absent,
    ...inventory(destination),
    productionStarted: false,
    migrationsApplied: false,
    internalJunctionsLocationPinned: true,
  };
  put(path.join(destination, 'release.json'), JSON.stringify(receipt, null, 2) + '\n');
  return verifyGuardedRelease(destination);
}
export function verifyGuardedRelease(destination, expectedManifestSHA256) {
  destination = path.resolve(destination);
  if (expectedManifestSHA256)
    assert(
      hash(path.join(destination, 'release.json')) === expectedManifestSHA256,
      'RELEASE_MANIFEST_CHANGED',
    );
  const r = read(path.join(destination, 'release.json'));
  assert(
    r.schema === 'paperfund-guarded-api-release-v1' && r.destination === destination,
    'REVIEWED_RELEASE_LOCATION_REQUIRED',
  );
  for (const b of r.bundles) {
    let text = fs.readFileSync(path.join(destination, b.path), 'utf8');
    assert(
      text.includes('authorizePaperBuy: admission.authorizePaperBuy ?? (async () => false)'),
      'COMPILED_DEFAULT_DENY_MISSING',
    );
    for (const change of b.replacements)
      text = text.split(JSON.stringify(change.relative)).join(JSON.stringify(change.original));
    const original =
      b.path === r.entry
        ? path.join(admission, 'restoration-api/main.mjs')
        : path.join(admission, 'production-routes.mjs');
    assert(text === fs.readFileSync(original, 'utf8'), 'NON_IMPORT_BUNDLE_CHANGE');
  }
  assert(
    fs
      .readFileSync(path.join(destination, r.entry), 'utf8')
      .includes('var database = createDatabase(config.DATABASE_URL);'),
    'ENTRY_AUTHORIZER_CHANGED',
  );
  const actual = inventory(destination);
  assert(
    JSON.stringify(actual) === JSON.stringify({ files: r.files, links: r.links }),
    'RELEASE_INTEGRITY_CHANGED',
  );
  for (const link of r.links)
    assert(
      /^runtime\/node_modules\/@paperfund\/(config|core|execution|protocols|shared)$/.test(
        link.path,
      ) && link.target === 'runtime/packages/' + link.path.split('/').at(-1),
      'UNAPPROVED_RELEASE_LINK',
    );
  for (const e of r.dependencyEdges) {
    const resolved = resolvePackage(path.join(destination, e.from), e.name);
    assert(
      resolved === fs.realpathSync(path.join(destination, e.to)),
      'FROZEN_DEPENDENCY_RESOLUTION_CHANGED:' + e.name,
    );
    assert(inside(destination, resolved), 'EXTERNAL_RUNTIME_DEPENDENCY');
  }
  assert(hash(r.configFile) === r.configSHA256, 'PROTECTED_CONFIG_CHANGED');
  assert(
    process.version === r.node.version && hash(process.execPath) === r.node.sha256,
    'NODE_RUNTIME_CHANGED',
  );
  for (const input of r.sourceInputs)
    assert(
      hash(path.join(root, input.path)) === input.sha256,
      'REVIEWED_SOURCE_CHANGED:' + input.path,
    );
  verifyOriginal();
  return r;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, destination, expected] = process.argv.slice(2);
  assert(
    ['prepare', 'verify'].includes(mode) &&
      destination &&
      (mode === 'prepare' || /^[a-f0-9]{64}$/i.test(expected ?? '')),
    'USAGE_PREPARE_DIRECTORY_OR_VERIFY_DIRECTORY_MANIFEST_SHA256',
  );
  const r =
    mode === 'prepare'
      ? prepareGuardedRelease(destination)
      : verifyGuardedRelease(destination, expected);
  console.log(
    JSON.stringify({
      status: 'PASS',
      destination: r.destination,
      files: r.files.length,
      packages: r.packages.length,
      defaultBuyAdmission: r.defaultBuyAdmission,
      productionStarted: false,
    }),
  );
}
