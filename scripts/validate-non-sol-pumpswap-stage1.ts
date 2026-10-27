/** Explicit read-only validator: never constructs a transaction, calls SQL or installs a route. */
import type * as PumpSwapSdk from '@pump-fun/pump-swap-sdk';
import { createProductionExecutionRouter } from '../packages/protocols/src/production.js';
import { config } from 'dotenv';
import { parseEnvironment } from '@paperfund/config';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { unpackMint, unpackAccount } from '@solana/spl-token';
import {
  Stage1NonSolPumpSwap,
  type Stage1Snapshot,
} from '../packages/protocols/src/experimental/non-sol-pump-swap.js';
import { SolanaRpcClient, WRAPPED_SOL_MINT } from '../packages/protocols/src/pump-fun.js';
import {
  pumpSwapGlobalConfigAddress,
  pumpSwapFeeConfigAddress,
  decodePumpSwapPool,
} from '../packages/protocols/src/pump-swap.js';
import { orcaLink, quoteSupplementalHop } from '../packages/protocols/src/composed-pump-orca.js';
const cases = {
  qubit: '5pHhLJn3nXKLXyHMpoMP8YLrt1Brt3z84NWspPkKWaep',
  tusd: '7UhL5K7t1UDPLdhoj2Sz59kyn79Qvxkvk75ukfxDTUSD',
  emoji: '9wcpJweVnKaGWhBd9xYT4ZXrjsyed53iipNiPQi6pump',
};
const validator = new Stage1NonSolPumpSwap({ purpose: 'READ_ONLY_STAGE1_VALIDATION' });
const json = (x: unknown) =>
  JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
let rpc: SolanaRpcClient | undefined;
if (process.argv.includes('--capture')) {
  config({ quiet: true });
  const e = parseEnvironment(process.env);
  rpc = new SolanaRpcClient({
    url: e.SOLANA_RPC_URL,
    timeoutMs: e.SOLANA_RPC_TIMEOUT_MS,
    commitment: e.SOLANA_COMMITMENT,
  });
}
const reference = process.argv.includes('--reference')
  ? (createRequire(import.meta.url)(
      '../node_modules/.cache/paperfund-stage1-reference/package/dist/index.js',
    ) as typeof PumpSwapSdk & { multiHopSwapQuote: (args: unknown) => { amountOut: BN } })
  : null;
let production: ReturnType<typeof createProductionExecutionRouter> | null = null;
if (process.argv.includes('--check-production')) {
  config({ quiet: true });
  const e = parseEnvironment(process.env);
  production = createProductionExecutionRouter({
    rpcUrl: e.SOLANA_RPC_URL,
    rpcTimeoutMs: e.SOLANA_RPC_TIMEOUT_MS,
    commitment: e.SOLANA_COMMITMENT,
  });
}
if (process.argv.includes('--capture') && !reference)
  throw Error('--capture requires --reference to preserve independently priced fixtures');
const referenceFees = reference
  ? (createRequire(import.meta.url)(
      '../node_modules/.cache/paperfund-stage1-reference/package/dist/sdk/buy.js',
    ) as {
      exactQuoteInFees: (
        amount: BN,
        rates: { lpFeeBps: BN; protocolFeeBps: BN; creatorFeeBps: BN },
      ) => { lpFee: BN; protocolFee: BN; coinCreatorFee: BN };
    })
  : null;
for (const [name, m] of Object.entries(cases)) {
  if (production) {
    try {
      await production.mintResolver!(m);
      throw new Error('UNEXPECTED_PRODUCTION_SUPPORT');
    } catch (e) {
      if (
        !(e instanceof Error) ||
        !('code' in e) ||
        e.code !== 'POSITION_EXECUTION_ROUTE_UNAVAILABLE'
      )
        throw e;
      console.log(name, 'PRODUCTION_GUARD_REJECTED', e.code);
    }
  }
  const file = new URL(
    '../packages/protocols/test/fixtures/non-sol-stage1/' + name + '.json',
    import.meta.url,
  );
  const s: Stage1Snapshot = rpc
    ? await validator.capture(rpc, m)
    : JSON.parse(readFileSync(file, 'utf8')).snapshot;
  const policy = { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 };
  const info = (a: string) => {
    const raw = s.accounts[a]!;
    return {
      data: Buffer.from(raw.base64, 'base64'),
      owner: new PublicKey(raw.owner),
      executable: false,
      lamports: 0,
      rentEpoch: 0,
    };
  };
  const p = decodePumpSwapPool(info(s.targetPool).data),
    link = orcaLink(s.bridgePool, s.accounts[s.bridgePool]!);
  const token = unpackMint(new PublicKey(s.mint), info(s.mint), info(s.mint).owner);
  const va = unpackAccount(new PublicKey(p.baseVault), info(p.baseVault), info(p.baseVault).owner),
    vq = unpackAccount(new PublicKey(p.quoteVault), info(p.quoteVault), info(p.quoteVault).owner);
  const clock = info('SysvarC1ock11111111111111111111111111111111').data,
    time = clock.readBigInt64LE(32);
  const globalAddress = await pumpSwapGlobalConfigAddress(),
    feeAddress = await pumpSwapFeeConfigAddress();
  const pool = reference?.PUMP_AMM_SDK.decodePool(info(s.targetPool)),
    global = reference?.PUMP_AMM_SDK.decodeGlobalConfig(info(globalAddress)),
    feeConfig = reference?.PUMP_AMM_SDK.decodeFeeConfig(info(feeAddress));
  const hop = pool
    ? {
        kind: 'pool',
        poolKey: new PublicKey(s.targetPool),
        pool,
        baseTokenProgram: info(s.mint).owner,
        quoteTokenProgram: info(s.quoteMint).owner,
        poolBaseAmount: new BN(va.amount.toString()),
        poolQuoteAmount: new BN(vq.amount.toString()),
        baseMintSupply: new BN(token.supply.toString()),
      }
    : null;
  const refs = [];
  const results = [];
  for (const amount of [100000000n, 1000000000n, 2000000000n, 10000000000n]) {
    const buy = await validator.quote(s, amount, true, policy),
      sell = await validator.quote(s, buy.output, false, policy);
    results.push({ input: amount, buy: buy.output, sell: sell.output, slot: s.slot });
    if (reference && pool) {
      // Reference never calls stage1PoolSwap: current official SDK prices target; existing Orca SDK prices bridge.
      const bridge = quoteSupplementalHop(
        link,
        s.accounts,
        amount,
        link.mintA === WRAPPED_SOL_MINT,
        time,
        token.supply,
        s.absentAccounts,
      );
      const target = reference.multiHopSwapQuote({
        inMint: new PublicKey(s.quoteMint),
        hops: [hop],
        amountIn: new BN(bridge.output.toString()),
        slippage: 0,
        globalConfig: global,
        feeConfig,
      }).amountOut;
      const exits = [];
      for (const percent of [25n, 50n, 75n, 100n]) {
        const quantity = (BigInt(target.toString()) * percent) / 100n;
        const q = reference.multiHopSwapQuote({
          inMint: new PublicKey(s.mint),
          hops: [hop],
          amountIn: new BN(quantity.toString()),
          slippage: 0,
          globalConfig: global,
          feeConfig,
        }).amountOut;
        const out = quoteSupplementalHop(
          link,
          s.accounts,
          BigInt(q.toString()),
          link.mintA === s.quoteMint,
          time,
          token.supply,
          s.absentAccounts,
        );
        exits.push({
          percent,
          quantity,
          targetOutput: q.toString(),
          bridgeOutput: out.output,
          bridgeFee: out.lp,
        });
      }
      const rates = reference.computeFeesBps({
        globalConfig: global!,
        feeConfig: feeConfig!,
        creator: pool.creator,
        baseMintSupply: new BN(token.supply.toString()),
        baseMint: pool.baseMint,
        baseReserve: new BN(va.amount.toString()),
        quoteReserve: new BN(vq.amount.toString()).add(pool.virtualQuoteReserves),
        quoteMint: pool.quoteMint,
        isMayhemMode: pool.isMayhemMode,
        creatorFeeBps: pool.creatorFeeBps,
      });
      refs.push({
        input: amount,
        bridgeOutput: bridge.output,
        bridgeFee: bridge.lp,
        targetOutput: target.toString(),
        targetFees: (() => {
          const f = referenceFees!.exactQuoteInFees(new BN(bridge.output.toString()), rates);
          return {
            lp: f.lpFee.toString(),
            protocol: f.protocolFee.toString(),
            creator: f.coinCreatorFee.toString(),
          };
        })(),
        rates: {
          lp: rates.lpFeeBps.toString(),
          protocol: rates.protocolFeeBps.toString(),
          creator: rates.creatorFeeBps.toString(),
        },
        exits,
      });
    }
  }
  let referenceCapacity: unknown = null;
  if (reference && pool) {
    const refSell = (amount: bigint) => {
      const target = reference.multiHopSwapQuote({
        inMint: new PublicKey(s.mint),
        hops: [hop],
        amountIn: new BN(amount.toString()),
        slippage: 0,
        globalConfig: global,
        feeConfig,
      }).amountOut;
      return quoteSupplementalHop(
        link,
        s.accounts,
        BigInt(target.toString()),
        link.mintA === s.quoteMint,
        time,
        token.supply,
        s.absentAccounts,
      ).output;
    };
    let low = 0n,
      high = token.supply;
    try {
      while (low < high) {
        const mid = (low + high + 1n) / 2n;
        try {
          refSell(mid);
          low = mid;
        } catch (e) {
          const reason = e instanceof Error ? e.message : '';
          if (reason.includes('Insufficient real quote reserves')) high = mid - 1n;
          else throw e;
        }
      }
      referenceCapacity = { max: low, output: refSell(low) };
    } catch (e) {
      referenceCapacity = { status: 'BLOCKED', reason: e instanceof Error ? e.message : 'UNKNOWN' };
    }
  }
  let capacity: unknown;
  try {
    const e = await validator.exits(s, token.supply, policy);
    capacity = {
      requested: token.supply,
      max: e.maxQuantity,
      output: e.maxOutput,
      full: e.full.reason,
    };
  } catch (e) {
    capacity = { status: 'BLOCKED', reason: e instanceof Error ? e.message : 'UNKNOWN' };
  }
  if (rpc || reference)
    writeFileSync(
      file,
      json({
        provenance: {
          source: 'confirmed Solana getMultipleAccounts single-bank capture',
          reference: reference ? '@pump-fun/pump-swap-sdk 2.1.0 + existing Orca SDK' : null,
          sdkIntegrity:
            'sha512-O0ulb5In/pMzxpcWIkzU17N27HQNZhGGof4fhgXZUkRj/vDbrZsDrViNoouhR52bvtfRf61e/bSvEg/h+35ueA==',
        },
        snapshot: s,
        references: refs,
        capacity,
        referenceCapacity,
      }),
    );
  console.log(json({ name, results, capacity }));
}
