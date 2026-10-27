import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { TransferFeeConfigLayout } from '@solana/spl-token';
import {
  Stage1NonSolPumpSwap,
  stage1PoolSwap,
  type Stage1Snapshot,
  type PoolMath,
} from '../src/experimental/non-sol-pump-swap.js';
import { orcaLink } from '../src/composed-pump-orca.js';
import { pumpBondingCurveAddress, type SolanaRpcClient } from '../src/pump-fun.js';
import { SolanaRouteSource, installSolanaMintResolver } from '../src/solana-routes.js';
import { ExecutionRouter } from '@paperfund/execution';
interface Reference {
  input: string;
  bridgeOutput: string;
  bridgeFee: string;
  targetOutput: string;
  targetFees: { lp: string; protocol: string; creator: string };
  rates: { lp: string; protocol: string; creator: string };
  exits: {
    percent: string;
    quantity: string;
    targetOutput: string;
    bridgeOutput: string;
    bridgeFee: string;
  }[];
}
interface Fixture {
  snapshot: Stage1Snapshot;
  references: Reference[];
  referenceCapacity: { max: string; output: string };
  capacity: { requested: string };
}
function fixture(name = 'qubit'): Fixture {
  return JSON.parse(
    readFileSync(new URL('./fixtures/non-sol-stage1/' + name + '.json', import.meta.url), 'utf8'),
  );
}
const validator = new Stage1NonSolPumpSwap({ purpose: 'READ_ONLY_STAGE1_VALIDATION' });
const policy = (s: Stage1Snapshot) => ({ nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 });
function edit(s: Stage1Snapshot, address: string, fn: (b: Buffer) => void) {
  const b = Buffer.from(s.accounts[address]!.base64, 'base64');
  fn(b);
  s.accounts[address] = { ...s.accounts[address]!, base64: b.toString('base64') };
}
const math: PoolMath = {
  base: 1000000n,
  quote: 100000n,
  virtual: 100000n,
  protocolBucket: 1000n,
  creatorBucket: 2000n,
  lpBps: 20n,
  protocolBps: 5n,
  creatorBps: 300n,
  buybackBps: 5000n,
};
describe('Stage 1 isolated recorded route validation', () => {
  it('is off without explicit read-only construction and has no production entry import/export', () => {
    expect(() => new Stage1NonSolPumpSwap()).toThrow('STAGE1_DISABLED');
    for (const path of ['../src/production.ts', '../src/index.ts', '../src/solana-routes.ts'])
      expect(readFileSync(new URL(path, import.meta.url), 'utf8')).not.toContain(
        'experimental/non-sol-pump-swap',
      );
  });
  it.each(['qubit', 'tusd', 'emoji'])(
    'matches independent SDK 2.1.0 and Orca reference amounts/fees for %s',
    async (name) => {
      const { snapshot: s, references } = fixture(name),
        before = JSON.stringify(s);
      for (const r of references) {
        const q = await validator.quote(s, BigInt(r.input), true, policy(s));
        expect(q.input).toBe(BigInt(r.input));
        expect(q.output).toBe(BigInt(r.targetOutput));
        expect(q.bridge.output).toBe(BigInt(r.bridgeOutput));
        expect(q.bridge.lp).toBe(BigInt(r.bridgeFee));
        expect([q.target.fees.lp, q.target.fees.protocol, q.target.fees.creator]).toEqual([
          BigInt(r.targetFees.lp),
          BigInt(r.targetFees.protocol),
          BigInt(r.targetFees.creator),
        ]);
        const state = await validator.validate(s, policy(s));
        expect([state.math.lpBps, state.math.protocolBps, state.math.creatorBps]).toEqual([
          BigInt(r.rates.lp),
          BigInt(r.rates.protocol),
          BigInt(r.rates.creator),
        ]);
        for (const e of r.exits) {
          const exit = await validator.quote(s, BigInt(e.quantity), false, policy(s));
          expect(exit.target.output).toBe(BigInt(e.targetOutput));
          expect(exit.output).toBe(BigInt(e.bridgeOutput));
          expect(exit.bridge.lp).toBe(BigInt(e.bridgeFee));
        }
      }
      expect(JSON.stringify(s)).toBe(before);
      const r = references[1]!,
        a = await validator.quote(s, BigInt(r.input), true, policy(s));
      expect(await validator.quote(JSON.parse(before), BigInt(r.input), true, policy(s))).toEqual(
        a,
      );
    },
  );
  it.each(['qubit', 'tusd', 'emoji'])(
    'matches independent maximum capacity and executable boundary for %s',
    async (name) => {
      const f = fixture(name),
        s = f.snapshot,
        e = await validator.exits(s, BigInt(f.capacity.requested), policy(s));
      expect(e.full.reason).toBe('INSUFFICIENT_EXECUTABLE_LIQUIDITY');
      expect(e.maxQuantity).toBe(BigInt(f.referenceCapacity.max));
      expect(e.maxOutput).toBe(BigInt(f.referenceCapacity.output));
      await expect(validator.quote(s, e.maxQuantity + 1n, false, policy(s))).rejects.toMatchObject({
        code: 'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
      });
    },
  );
  it.each(['qubit', 'tusd', 'emoji'])(
    'keeps the production non-SOL migration guard for %s',
    async (name) => {
      const s = fixture(name).snapshot;
      let discoveries = 0;
      const rpc = {
        getMultipleAccounts: async (addresses: readonly string[]) => ({
          context: { slot: s.slot },
          value: addresses.map((a) =>
            s.accounts[a]
              ? { owner: s.accounts[a]!.owner, data: [s.accounts[a]!.base64, 'base64'] as const }
              : null,
          ),
        }),
      } as unknown as SolanaRpcClient;
      const router = new ExecutionRouter();
      installSolanaMintResolver(
        router,
        new SolanaRouteSource(rpc, {
          pools: async () => {
            discoveries++;
            return [];
          },
          context: async () => [],
        }),
      );
      await expect(router.mintResolver!(s.mint)).rejects.toMatchObject({
        code: 'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
      });
      expect(discoveries).toBe(0);
    },
  );
  it('rejects stale capture/bank time, impossible slots and wrong scope', async () => {
    const s = fixture().snapshot;
    await expect(
      validator.quote(s, 1000000000n, true, {
        ...policy(s),
        nowMs: Date.parse(s.observedAt) + 11000,
      }),
    ).rejects.toThrow('STALE');
    const clock = 'SysvarC1ock11111111111111111111111111111111';
    edit(s, clock, (b) => b.writeBigUInt64LE(BigInt(s.slot) + 1n, 0));
    await expect(validator.quote(s, 1n, true, policy(s))).rejects.toThrow('CLOCK');
    const bad = fixture().snapshot;
    bad.mint = fixture('emoji').snapshot.mint;
    await expect(validator.quote(bad, 1n, true, policy(bad))).rejects.toThrow();
  });
  it('rejects target orientation, mint owner and pre-migration evidence', async () => {
    const a = fixture().snapshot;
    edit(a, a.targetPool, (b) => new PublicKey(a.quoteMint).toBuffer().copy(b, 43));
    await expect(validator.quote(a, 1n, true, policy(a))).rejects.toThrow('IDENTITY');
    const b = fixture().snapshot;
    b.accounts[b.quoteMint] = {
      ...b.accounts[b.quoteMint]!,
      owner: '11111111111111111111111111111111',
    };
    await expect(validator.quote(b, 1n, true, policy(b))).rejects.toThrow('MINT_OWNER');
    const c = fixture().snapshot;
    edit(c, await pumpBondingCurveAddress(c.mint), (bytes) => {
      bytes[48] = 0;
    });
    await expect(validator.quote(c, 1n, true, policy(c))).rejects.toThrow('MIGRATION_IDENTITY');
  });
  it('does not turn missing Orca ticks into liquidity zero/capacity', async () => {
    const s = fixture().snapshot,
      link = orcaLink(s.bridgePool, s.accounts[s.bridgePool]!);
    for (const a of link.extraAccounts ?? []) {
      delete s.accounts[a];
      s.absentAccounts = s.absentAccounts.filter((x) => x !== a);
    }
    await expect(validator.exits(s, 1000000000000n, policy(s))).rejects.toThrow();
  });
  it('rejects nonzero Token-2022 transfer fees instead of silently skipping them', async () => {
    const s = fixture().snapshot,
      raw = Buffer.from(s.accounts[s.mint]!.base64, 'base64'),
      tf = Buffer.alloc(4 + TransferFeeConfigLayout.span);
    tf.writeUInt16LE(1, 0);
    tf.writeUInt16LE(TransferFeeConfigLayout.span, 2);
    const fee = { epoch: 0n, maximumFee: 10n, transferFeeBasisPoints: 100 };
    TransferFeeConfigLayout.encode(
      {
        transferFeeConfigAuthority: PublicKey.default,
        withdrawWithheldAuthority: PublicKey.default,
        withheldAmount: 0n,
        olderTransferFee: fee,
        newerTransferFee: fee,
      },
      tf.subarray(4),
    );
    s.accounts[s.mint] = {
      ...s.accounts[s.mint]!,
      base64: Buffer.concat([raw, tf]).toString('base64'),
    };
    await expect(validator.quote(s, 1000000000n, true, policy(s))).rejects.toThrow(
      'TRANSFER_FEES_UNSUPPORTED',
    );
  });
  it('keeps bridge funding failure distinct from target funding failure', async () => {
    const s = fixture().snapshot,
      link = orcaLink(s.bridgePool, s.accounts[s.bridgePool]!);
    edit(s, link.vaultB, (b) => b.writeBigUInt64LE(0n, 64));
    await expect(validator.quote(s, 1000000000n, true, policy(s))).rejects.toThrow(
      'BRIDGE_RESERVES',
    );
  });
  it('crosses Orca ticks on a recorded large quote without inventing reserves', async () => {
    const s = fixture().snapshot,
      q = await validator.quote(s, 10000000000n, true, policy(s));
    expect(q.bridge.detail['endTick']).not.toBe(q.bridge.detail['tickCurrentIndex']);
    expect(q.target.post.base).toBeLessThan((await validator.validate(s, policy(s))).math.base);
  });
  it('rejects malformed RPC cardinality during final atomic capture', async () => {
    const s = fixture().snapshot;
    let calls = 0;
    const rpc = {
      getMultipleAccounts: async (addresses: readonly string[]) => {
        calls++;
        return {
          context: { slot: s.slot },
          value: addresses
            .map((a) =>
              s.accounts[a]
                ? { owner: s.accounts[a]!.owner, data: [s.accounts[a]!.base64, 'base64'] as const }
                : null,
            )
            .slice(0, calls === 3 ? 1 : addresses.length),
        };
      },
    };
    await expect(validator.capture(rpc, s.mint)).rejects.toThrow('BATCH_INCONSISTENT');
    expect(calls).toBe(3);
  });
});
describe('asset-neutral v2 integer money invariants', () => {
  it('preserves buy and sell effective/real reserve and fee conservation', () => {
    const b = stage1PoolSwap(math, 1000n, true),
      s = stage1PoolSwap(math, 1000n, false);
    for (const q of [b, s]) {
      expect(q.fees.buyback <= q.fees.protocol).toBe(true);
      expect(q.post.quote - q.post.protocolBucket - q.post.creatorBucket >= 0n).toBe(true);
    }
    expect(b.post.quote + b.post.virtual).toBe(
      math.quote + math.virtual + b.input - b.fees.protocol - b.fees.creator,
    );
    expect(s.post.quote + s.post.virtual).toBe(
      math.quote + math.virtual - s.output - s.fees.protocol - s.fees.creator,
    );
    expect(s.post.base).toBe(math.base + s.input);
  });
  it('handles zero/dust, u64 bounds, fee buckets and signed virtual reserves', () => {
    for (const n of [0n, 1n, 2n]) expect(() => stage1PoolSwap(math, n, true)).toThrow();
    for (const n of [-1n, 1n << 64n]) expect(() => stage1PoolSwap(math, n, true)).toThrow('U64');
    expect(() =>
      stage1PoolSwap({ ...math, protocolBucket: math.quote + 1n }, 1000n, false),
    ).toThrow('RESERVES');
    expect(stage1PoolSwap({ ...math, virtual: -1000n }, 1000n, false).output).toBeGreaterThan(0n);
    expect(() =>
      stage1PoolSwap({ ...math, protocolBucket: math.quote, creatorBucket: 0n }, 10000n, false),
    ).toThrow('TARGET_REAL_RESERVES');
  });
  it('keeps impact size dependent and rejects unsupported orientation', () => {
    const small = stage1PoolSwap(math, 1000n, true),
      large = stage1PoolSwap(math, 100000n, true);
    expect(large.output).toBeLessThan(small.output * 100n);
  });
});
