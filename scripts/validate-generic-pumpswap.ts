/** Explicit read-only shadow validation. No API/SQL/trades or runtime activation. */
import { config } from 'dotenv';
import { parseEnvironment } from '@paperfund/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { unpackAccount, unpackMint } from '@solana/spl-token';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import { createProductionExecutionRouter } from '../packages/protocols/src/production.js';
import { withAdvisoryRead } from '../packages/protocols/src/rpc-read-context.js';
import { WRAPPED_SOL_MINT } from '../packages/protocols/src/pump-fun.js';
import {
  decodePumpSwapPool,
  pumpSwapGlobalConfigAddress,
  pumpSwapFeeConfigAddress,
} from '../packages/protocols/src/pump-swap.js';
import { orcaLink, quoteSupplementalHop } from '../packages/protocols/src/composed-pump-orca.js';
import { canonicalExitPreflight } from '@paperfund/execution';
import type { Stage1Snapshot } from '../packages/protocols/src/experimental/non-sol-pump-swap.js';
import type * as PumpSdk from '@pump-fun/pump-swap-sdk';
import { workingVectors } from '../packages/protocols/test/fixtures/stage2-working-vectors.js';
import { isDeepStrictEqual } from 'node:util';
const json = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
if (!process.argv.includes('--live-read-only')) {
  const before = JSON.parse(
    readFileSync('packages/protocols/test/fixtures/generic-pumpswap-before.json', 'utf8'),
  );
  if (
    !isDeepStrictEqual(before.legacyOff, await workingVectors(false)) ||
    !isDeepStrictEqual(before.legacyRestrictedOn, await workingVectors(true))
  )
    throw Error('Existing OFF parity differs');
  console.log(
    'Seven OFF/ON fixed-state branches preserved; run generic-pump-swap.test.ts for complete three-route vectors.',
  );
} else {
  config({ quiet: true });
  const e = parseEnvironment(process.env);
  if (
    process.env['GENERIC_PUMPSWAP_ENABLED'] === 'true' ||
    process.env['GENERIC_PUMPSWAP_BUYS_ENABLED'] === 'true'
  )
    throw Error('Shadow probe requires real generic capability OFF');
  const sdk = createRequire(import.meta.url)(
    '../node_modules/.cache/paperfund-stage1-reference/package/dist/index.js',
  ) as typeof PumpSdk & { multiHopSwapQuote(args: unknown): { amountOut: BN } };
  const cases: [string, string][] = [
    ['qubit', '5pHhLJn3nXKLXyHMpoMP8YLrt1Brt3z84NWspPkKWaep'],
    ['tusd', '7UhL5K7t1UDPLdhoj2Sz59kyn79Qvxkvk75ukfxDTUSD'],
    ['emoji', '9wcpJweVnKaGWhBd9xYT4ZXrjsyed53iipNiPQi6pump'],
    ['shunghla', '2SESLWryE5mmgeLQJcNezZVMfZwpBtLbxUaVW2MZpump'],
    ['nvda-cartridge', 'ArenDYANqFNkp8ZqAXt69vT5Dz7WD4zDfSpVw6oPpump'],
    ['tesla-teslasi', 'DU148VhedGj3LHj7ZPDpw1q8S6ecTne33PPh7frdDkU4'],
    ['native-sol', '3n51PDRJaKKJQyFA2zeqHNKvMavTsbd8RyoAJcHPpump'],
    ['active-stock', 'BsCrE8ZBoqwzv1Yix8uV6S7MmvmH6R7B5Nv3Su8CtmN3'],
  ];
  const results: unknown[] = [];
  let stopped = false;
  const onlyArg = process.argv.find((v) => v.startsWith('--targets='));
  const selectedCases = onlyArg
    ? cases.filter(([name]) => onlyArg.slice(10).split(',').includes(name))
    : cases;
  for (const [name, mint] of selectedCases) {
    if (stopped) break;
    const router = createProductionExecutionRouter({
      rpcUrl: e.SOLANA_RPC_URL,
      rpcTimeoutMs: e.SOLANA_RPC_TIMEOUT_MS,
      commitment: e.SOLANA_COMMITMENT,
      genericPumpSwapEnabled: true,
      genericPumpSwapBuysEnabled: true,
      genericAccessResolver: async () => ({ discover: true, buy: true }),
    });
    for (const phase of ['cold', 'warm']) {
      if (stopped) break;
      const metrics = { rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 },
        started = performance.now();
      const result: Record<string, unknown> = { name, mint, phase, at: new Date().toISOString() };
      try {
        await withAdvisoryRead({ signal: AbortSignal.timeout(8000), metrics }, async () => {
          const discoveryStart = performance.now();
          const identity = await router.mintResolver!(mint);
          result['discoveryMs'] = Math.round(performance.now() - discoveryStart);
          const captureStart = performance.now();
          const { route, adapter, state } = await router.loadPositionRoute(identity);
          result['captureMs'] = Math.round(performance.now() - captureStart);
          result['protocol'] = route.executionIdentity.protocolId;
          result['slot'] = state.chainSlot?.toString();
          const req = {
              identity: route.executionIdentity,
              orderId: identifier('generic-shadow', 'OrderId'),
              executionId: identifier('generic-shadow', 'ExecutionId'),
              executedAt: utcInstant(new Date()),
            },
            input = 100000000n;
          const buyStart = performance.now();
          const buy = await adapter.simulateBuy(
            { ...req, requestedPaperSol: paperSolBaseUnits(input) },
            state,
          );
          result['buyMs'] = Math.round(performance.now() - buyStart);
          const sellStart = performance.now();
          const exit = await canonicalExitPreflight(
            {
              loadPositionRoute: async () => ({ route, adapter, state }),
            } as unknown as typeof router,
            identity,
            buy.actualOutput.amount,
            input,
          );
          result['sellPreflightMs'] = Math.round(performance.now() - sellStart);
          result['buyUnits'] = buy.actualOutput.amount.toString();
          result['fullSell'] = exit.full.outputLamports?.toString();
          result['percentages'] = Object.fromEntries(
            Object.entries(exit.percentages).map(([p, q]) => [
              p,
              { executable: q.executable, output: q.outputLamports?.toString(), reason: q.reason },
            ]),
          );
          result['state'] = state.normalizedState['hops'];
          result['status'] = exit.full.executable ? 'PASS' : 'UNAVAILABLE';
          const snapshot = state.normalizedState['stage1Snapshot'] as unknown as
            Stage1Snapshot | undefined;
          if (snapshot) {
            const info = (a: string) => {
              const x = snapshot.accounts[a]!;
              return {
                data: Buffer.from(x.base64, 'base64'),
                owner: new PublicKey(x.owner),
                executable: false,
                lamports: 0,
                rentEpoch: 0,
              };
            };
            const p = decodePumpSwapPool(info(snapshot.targetPool).data),
              v = unpackAccount(
                new PublicKey(p.baseVault),
                info(p.baseVault),
                info(p.baseVault).owner,
              ),
              q = unpackAccount(
                new PublicKey(p.quoteVault),
                info(p.quoteVault),
                info(p.quoteVault).owner,
              ),
              token = unpackMint(new PublicKey(mint), info(mint), info(mint).owner),
              quote = unpackMint(
                new PublicKey(snapshot.quoteMint),
                info(snapshot.quoteMint),
                info(snapshot.quoteMint).owner,
              ),
              link = orcaLink(snapshot.bridgePool, snapshot.accounts[snapshot.bridgePool]!),
              time = info('SysvarC1ock11111111111111111111111111111111').data.readBigInt64LE(32);
            const hop = {
              kind: 'pool',
              poolKey: new PublicKey(snapshot.targetPool),
              pool: sdk.PUMP_AMM_SDK.decodePool(info(snapshot.targetPool)),
              baseTokenProgram: info(mint).owner,
              quoteTokenProgram: info(snapshot.quoteMint).owner,
              poolBaseAmount: new BN(v.amount.toString()),
              poolQuoteAmount: new BN(q.amount.toString()),
              baseMintSupply: new BN(token.supply.toString()),
            };
            const globalConfig = sdk.PUMP_AMM_SDK.decodeGlobalConfig(
                info(await pumpSwapGlobalConfigAddress()),
              ),
              feeConfig = sdk.PUMP_AMM_SDK.decodeFeeConfig(info(await pumpSwapFeeConfigAddress()));
            const bridge = quoteSupplementalHop(
                link,
                snapshot.accounts,
                input,
                link.mintA === WRAPPED_SOL_MINT,
                time,
                quote.supply,
                snapshot.absentAccounts,
              ),
              target = sdk.multiHopSwapQuote({
                inMint: new PublicKey(snapshot.quoteMint),
                hops: [hop],
                amountIn: new BN(bridge.output.toString()),
                slippage: 0,
                globalConfig,
                feeConfig,
              }).amountOut;
            if (target.toString() !== buy.actualOutput.amount.toString())
              throw Error('Independent SDK BUY discrepancy');
            const refs = [];
            for (const percent of [25n, 50n, 75n, 100n]) {
              const quantity = (buy.actualOutput.amount * percent) / 100n,
                targetSell = sdk.multiHopSwapQuote({
                  inMint: new PublicKey(mint),
                  hops: [hop],
                  amountIn: new BN(quantity.toString()),
                  slippage: 0,
                  globalConfig,
                  feeConfig,
                }).amountOut;
              const net = quoteSupplementalHop(
                link,
                snapshot.accounts,
                BigInt(targetSell.toString()),
                link.mintA === snapshot.quoteMint,
                time,
                quote.supply,
                snapshot.absentAccounts,
              ).output;
              if (
                net.toString() !==
                exit.percentages[
                  percent.toString() as '25' | '50' | '75' | '100'
                ].outputLamports?.toString()
              )
                throw Error('Independent SDK SELL discrepancy');
              refs.push({
                percent: percent.toString(),
                quantity: quantity.toString(),
                targetQuoteUnits: targetSell.toString(),
                netSol: net.toString(),
              });
            }
            result['quoteMint'] = snapshot.quoteMint;
            result['targetPool'] = snapshot.targetPool;
            result['bridgePool'] = snapshot.bridgePool;
            result['sdkParity'] = true;
            try {
              result['supplyExitCapacity'] = (
                await adapter.maxExecutableSellQuantity!(
                  {
                    identity: route.executionIdentity,
                    tokenQuantity: tokenBaseUnits(token.supply),
                  },
                  state,
                )
              ).toString();
            } catch (err) {
              result['supplyExitCapacity'] = {
                status: 'BLOCKED',
                reason: err instanceof Error ? err.message : 'UNKNOWN',
              };
            }
            if (process.argv.includes('--capture')) {
              const recordedFile =
                'packages/protocols/test/fixtures/generic-pumpswap-live/' +
                name +
                '-' +
                phase +
                '.json';
              if (existsSync(recordedFile))
                throw Error(
                  'Refusing to overwrite recorded generic fixture; omit --capture for new timing probes',
                );
              mkdirSync('packages/protocols/test/fixtures/generic-pumpswap-live', {
                recursive: true,
              });
              writeFileSync(
                'packages/protocols/test/fixtures/generic-pumpswap-live/' +
                  name +
                  '-' +
                  phase +
                  '.json',
                json({ snapshot, result, references: refs }),
              );
            }
          }
        });
      } catch (err) {
        result['status'] = 'BLOCKED';
        result['reason'] = err instanceof Error ? err.message : 'UNKNOWN';
        result['code'] = err && typeof err === 'object' && 'code' in err ? err.code : null;
      }
      result['elapsedMs'] = Math.round(performance.now() - started);
      result['metrics'] = metrics;
      results.push(result);
      console.log(json(result));
      if (metrics.rateLimits > 0) stopped = true;
      await new Promise((r) => setTimeout(r, 1800));
    }
  }
  const summary = {
    at: new Date().toISOString(),
    providerHost: new URL(e.SOLANA_RPC_URL).hostname,
    commitment: e.SOLANA_COMMITMENT,
    runtimeGenericEnabled: false,
    rateLimitStop: stopped,
    results,
  };
  const evidenceArg = process.argv.find((v) => v.startsWith('--evidence='));
  if (evidenceArg) writeFileSync(evidenceArg.slice(11), json(summary));
  if (process.argv.includes('--capture')) {
    mkdirSync('docs/evidence', { recursive: true });
    writeFileSync('docs/evidence/generic-pumpswap-shadow.json', json(summary));
  }
}
