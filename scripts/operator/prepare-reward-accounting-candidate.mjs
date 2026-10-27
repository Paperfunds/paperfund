// Build a non-activating worker overlay against the immutable v6 dependency closure.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire, builtinModules } from 'node:module';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '../..'),
  dir = path.join(root, 'docs/reward-accounting-20261027/candidate-final-reviewed'),
  base = path.join(
    root,
    'docs/operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified',
  );
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
  slash = (p) => p.replaceAll('\\', '/');
if (
  sha(path.join(base, 'release.json')) !==
  '0fac0d6c89d3cb557d409ab1a63db57e0938f0addd27e0ec054112a7de4337f6'
)
  throw Error('V6_BASE_PIN');
if (fs.existsSync(dir)) throw Error('NEW_CANDIDATE_ONLY');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'worker.mjs'),
  external = new Map();
const result = await build({
  entryPoints: [path.join(root, 'apps/worker/src/index.ts')],
  outfile: file,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  metafile: true,
  plugins: [
    {
      name: 'reviewed-worker-composition',
      setup(b) {
        b.onLoad({ filter: /apps[\\/]worker[\\/]src[\\/]index\.ts$/ }, (args) => {
          let contents = fs.readFileSync(args.path, 'utf8');
          const replace = (from, to) => {
            if (contents.split(from).length !== 2) throw Error('WORKER_ANCHOR:' + from);
            contents = contents.replace(from, to);
          };
          replace(
            'const database = createDatabase(config.DATABASE_URL);',
            'let database = createDatabase(config.DATABASE_URL);',
          );
          replace(
            'const router = createProductionExecutionRouter({',
            'let router = createProductionExecutionRouter({',
          );
          replace(
            'const creatorFeeSource =',
            'const rewardRuntime = await connectRewardRuntime(database,router,config); database=rewardRuntime.database;router=rewardRuntime.router;\nconst creatorFeeSource =',
          );
          replace(
            '  await database.close();',
            '  detachRewardDrain();\n  await rewardRuntime.stop();\n  await database.close();',
          );
          replace(
            "process.once('SIGINT', () => void shutdown('SIGINT'));",
            "const detachRewardDrain=rewardRuntime.attachDrain(()=>shutdown('SIGTERM'));\nprocess.once('SIGINT', () => void shutdown('SIGINT'));",
          );
          replace(
            'async function writeHeartbeat() {',
            'async function writeHeartbeat() {\nObject.assign(heartbeat,{rewardCapture:rewardRuntime.captureStatus});',
          );
          return {
            contents:
              'import {connectRewardRuntime} from "../isolated/reward-bootstrap.js";\n' + contents,
            loader: 'ts',
          };
        });
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('node:') || builtinModules.includes(args.path))
            return { path: args.path, external: true };
          if (args.path.startsWith('@paperfund/')) {
            const name = args.path.slice(11).split('/')[0];
            if (!['core', 'config', 'execution', 'protocols', 'db'].includes(name))
              throw Error('WORKSPACE_PACKAGE');
            return { path: path.join(root, 'packages', name, 'src/index.ts') };
          }
          if (path.isAbsolute(args.path)) return;
          const resolver = createRequire(path.join(args.resolveDir, '__reward_candidate__.cjs'));
          let resolved = fs.realpathSync(resolver.resolve(args.path));
          if (args.path === 'pg')
            resolved = resolved.replace(/lib[\\/]index\.js$/, 'esm/index.mjs');
          const frozen = path.join(base, 'runtime', path.relative(root, resolved));
          if (!fs.existsSync(frozen) || sha(frozen) !== sha(resolved))
            throw Error('UNFROZEN_DEPENDENCY:' + args.path);
          external.set(slash(path.relative(root, frozen)), sha(frozen));
          let rel = slash(path.relative(dir, frozen));
          if (!rel.startsWith('.')) rel = './' + rel;
          return { path: rel, external: true };
        });
      },
    },
  ],
});
for (const name of ['settlement.sql', 'durable.sql', 'platform-accounting.sql', 'grants.sql'])
  fs.copyFileSync(
    path.join(root, 'packages/db/isolated/current-quotes', name),
    path.join(dir, name),
    fs.constants.COPYFILE_EXCL,
  );
const inputs = Object.keys(result.metafile.inputs).map((p) => {
  const f = path.resolve(root, p);
  return { path: slash(path.relative(root, f)), sha256: sha(f) };
});
const operatorFiles = [];
const operatorSources=new Map();
for (const entry of ['automation-service', 'mainnet-tools']) {
  const target = path.join(dir, 'operator', entry + '.bundle.cjs');
  const opBuild=await build({
    entryPoints: [path.join(root, 'scripts/operator', entry + '.mjs')],
    outfile: target,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    metafile:true,
    define: { 'import.meta.url': JSON.stringify('file:///C:/PaperfundSigner/library.mjs') },
    plugins: [
      {
        name: 'existing-pump-commonjs',
        setup(b) {
          b.onLoad({ filter: /(?:automation-claim|receipts)\.mjs$/ }, (args) => ({
            contents: fs
              .readFileSync(args.path, 'utf8')
              .replace(
                "createRequire(import.meta.url)('@pump-fun/pump-sdk')",
                "require('@pump-fun/pump-sdk')",
              ),
            loader: 'js',
          }));
        },
      },
    ],
  });
  operatorFiles.push({ path: 'operator/' + entry + '.bundle.cjs', sha256: sha(target) });
  for(const input of Object.keys(opBuild.metafile.inputs)){const f=path.resolve(root,input),rel=slash(path.relative(root,f));if(!rel.includes('node_modules/'))operatorSources.set(rel,sha(f));}
}
const review = {
  schema: 'PAPERFUND_REWARD_ACCOUNTING_CANDIDATE_V1',
  createdAt: new Date().toISOString(),
  productionDeployed: false,
  financialAuthority: 'NONE',
  workerSHA256: sha(file),
  operatorFiles,
  operatorSources:[...operatorSources].map(([path,sha256])=>({path,sha256})),
  baseManifestSHA256: sha(path.join(base, 'release.json')),
  external: [...external].map(([path, sha256]) => ({ path, sha256 })),
  inputs,
  schemas: ['settlement.sql', 'durable.sql', 'platform-accounting.sql', 'grants.sql'].map(
    (path) => ({
      path,
      sha256: sha(dir + '/' + path),
    }),
  ),
  requiredProfile: {
    rewardSettlement: {
      model: 'DURABLE_QUOTE_V2',
      policyId: 'REQUIRES_EXPLICIT_FUTURE_POLICY_ENROLLMENT',
    },
  },
  blockers: [
    'No approved target policy/profile, SQL grants or production installation',
    'All actually used route coverage and authenticated continuous UTC acceptance required',
    'Fresh custody and genuine creator-fee funding missing',
  ],
};
fs.writeFileSync(dir + '/review.json', JSON.stringify(review, null, 2) + '\n');
fs.writeFileSync(dir + '/bundle-inputs.json', JSON.stringify(result.metafile, null, 2) + '\n');
console.log(
  JSON.stringify({
    prepared: true,
    workerSHA256: sha(file),
    reviewSHA256: sha(dir + '/review.json'),
    deployed: false,
  }),
);
