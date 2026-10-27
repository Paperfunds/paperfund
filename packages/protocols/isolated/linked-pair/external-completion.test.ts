import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pumpBank } from './pump-fixtures.js';
import { linkedBindings, linkedRoute, carryLinkedRoot } from './shared-bridge.js';
import { transitionMultiHop, multiHopDependencies } from './pump-multihop.js';
import { transitionLinkedSnapshot } from './native-transition.js';
import { WrappedSolFlow } from './wrapped-sol-flow.js';
import {
  newLinkedBranch,
  reconcileLinkedInterval,
  type Instruction,
  type Receipt,
  type ProviderInterval,
} from './external-flow.js';
import { WRAPPED_SOL_MINT, SPL_TOKEN_PROGRAM_ID } from '../../src/pump-fun.js';
import { PUMP_AMM_PROGRAM_ID, decodePumpSwapPool } from '../../src/pump-swap.js';
function instruction(mint: string, buy: boolean, input: bigint) {
  const s = linkedRoute(pumpBank(), mint),
    keys = [PUMP_AMM_PROGRAM_ID, 'user', 'source', 'destination', 'buyback'],
    hops = [s.bridgePool, s.targetPool];
  if (!buy) hops.reverse();
  const a = [
    'user',
    'source',
    'destination',
    'ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw',
    '5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx',
    'volume',
    'buyback',
    SPL_TOKEN_PROGRAM_ID,
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    '11111111111111111111111111111111',
    'event',
    PUMP_AMM_PROGRAM_ID,
    'pump',
    'pump-global',
    'pump-fees',
    'pump-event',
  ];
  for (const addr of hops) {
    const p = decodePumpSwapPool(Buffer.from(s.accounts[addr]!.base64, 'base64'));
    a.push(p.baseMint, p.quoteMint, addr, p.baseVault, p.quoteVault);
  }
  for (const key of a) if (!keys.includes(key)) keys.push(key);
  const data = Buffer.alloc(24);
  createHash('sha256').update('global:multi_hop_swap').digest().copy(data, 0, 0, 8);
  data.writeBigUInt64LE(input, 8);
  data.writeBigUInt64LE(1n, 16);
  return {
    s,
    keys,
    ix: {
      programIdIndex: 0,
      accounts: a.map((a) => keys.indexOf(a)),
      data: bs58.encode(data),
    } as Instruction,
  };
}
it('charges route-wide fees once, carries a shared bridge across two target routes and reverses partial/full exits', async () => {
  let root = pumpBank();
  for (const r of linkedBindings(root)) {
    const x = instruction(r.mint, true, 10000000n),
      buy = await transitionMultiHop(linkedRoute(root, r.mint), x.ix, x.keys);
    expect(buy.steps[0]!.fees.lp).toBe(0n);
    expect(buy.steps[0]!.fees.creator).toBe(0n);
    expect(buy.steps[0]!.fees.protocol).toBeGreaterThan(0n);
    expect(buy.steps[1]!.fees.protocol).toBe(0n);
    expect(buy.steps[1]!.fees.creator).toBeGreaterThan(0n);
    const ordinary = await transitionLinkedSnapshot(linkedRoute(root, r.mint), 10000000n, true, {
      nowMs: Date.parse(root.observedAt),
      maxAgeMs: 10000,
    });
    expect(buy.output).toBeGreaterThan(ordinary.quote.output);
    expect(buy.transfers).toHaveLength(4);
    root = carryLinkedRoot(root, buy.next);
    const partX = instruction(r.mint, false, buy.output / 4n),
      part = await transitionMultiHop(linkedRoute(root, r.mint), partX.ix, partX.keys);
    const fullX = instruction(r.mint, false, buy.output - buy.output / 4n),
      rest = await transitionMultiHop(part.next, fullX.ix, fullX.keys);
    expect(part.output + rest.output).toBeGreaterThan(0n);
    expect(part.output + rest.output).toBeLessThan(10000000n);
    expect(part.steps[0]!.fees.protocol).toBe(0n);
    expect(part.steps[1]!.fees.creator).toBe(0n);
    root = carryLinkedRoot(root, rest.next);
  }
});
it('never substitutes current state for absent historical multi-hop dependencies', async () => {
  const x = instruction(pumpBank().mint, true, 10000000n),
    s = structuredClone(x.s);
  delete s.accounts[s.targetPool];
  expect(multiHopDependencies(x.ix, x.keys)).toHaveLength(2);
  await expect(transitionMultiHop(s, x.ix, x.keys)).rejects.toThrow('DEPENDENCY_MISSING');
});
function system(accounts: number[], amount: bigint, create = false): Instruction {
  const b = Buffer.alloc(create ? 52 : 12);
  b.writeUInt32LE(create ? 0 : 2, 0);
  b.writeBigUInt64LE(amount, 4);
  if (create) b.writeBigUInt64LE(165n, 12);
  return { programIdIndex: 5, accounts, data: bs58.encode(b) };
}
it('carries WSOL closure through native lamports, restart, subsequent wrapping, sync and unwrapping without inventing funding', () => {
  const file = new URL(
      '../../../../docs/linked-pair-20261021/external-flow-completion/provider-459757884-459757890.json.gz',
      import.meta.url,
    ),
    s = JSON.parse(gunzipSync(readFileSync(file)).toString()).before,
    keys = [
      'wallet',
      'old',
      'new',
      WRAPPED_SOL_MINT,
      SPL_TOKEN_PROGRAM_ID,
      '11111111111111111111111111111111',
    ],
    rent = 1488440,
    meta = {
      err: null,
      fee: 0,
      preBalances: [10000000, rent + 100, 0, 0, 0, 0],
      postBalances: [10000000 + rent + 100, 0, 0, 0, 0, 0],
      preTokenBalances: [
        { accountIndex: 1, mint: WRAPPED_SOL_MINT, uiTokenAmount: { amount: '100' } },
      ],
      postTokenBalances: [],
      innerInstructions: [],
    };
  const t = {
      version: 0,
      transaction: { signatures: ['controlled'], message: { accountKeys: keys, instructions: [] } },
      meta,
    } as Receipt,
    deltas: Record<string, string> = { old: '10' },
    tokens = new Map([['old', 100n]]),
    flow = new WrappedSolFlow(t, keys, deltas, new Set(), s);
  flow.instruction(
    { programIdIndex: 4, accounts: [1, 0, 0], data: '' },
    Buffer.from([9]),
    1,
    [],
    tokens,
  );
  expect(deltas['lamports:wallet']).toBe('10');
  expect(deltas.old).toBeUndefined();
  const create = system([0, 2], BigInt(rent), true);
  flow.instruction(create, Buffer.from(bs58.decode(create.data)), 1, [], tokens);
  flow.instruction(
    { programIdIndex: 4, accounts: [2, 3], data: '' },
    Buffer.from([18]),
    1,
    [],
    tokens,
  );
  const transfer = system([0, 2], 1000n);
  flow.instruction(transfer, Buffer.from(bs58.decode(transfer.data)), 1, [], tokens);
  flow.instruction(
    { programIdIndex: 4, accounts: [2], data: '' },
    Buffer.from([17]),
    1,
    [],
    tokens,
  );
  expect(tokens.get('new')).toBe(1000n);
  flow.instruction(
    { programIdIndex: 4, accounts: [2, 0, 0], data: '' },
    Buffer.from([9]),
    1,
    [],
    tokens,
  );
  flow.verify();
  expect(deltas['lamports:wallet']).toBe('10');
  expect(deltas.new).toBeUndefined();
  const restarted = JSON.parse(JSON.stringify(deltas)) as Record<string, string>;
  expect(WrappedSolFlow.tracked(keys, restarted)).toBe(true);
  const next = {
    ...t,
    meta: {
      ...meta,
      preBalances: meta.postBalances,
      postBalances: meta.postBalances,
      preTokenBalances: [],
    },
  };
  const n = new WrappedSolFlow(next, keys, restarted, new Set(), s),
    over = system([0, 2], 999999999n);
  expect(() => n.instruction(over, Buffer.from(bs58.decode(over.data)), 1, [], new Map())).toThrow(
    'INVENTORY_EXHAUSTED',
  );
});

it('replays two genuine complete finalized intervals with prior paper impact, multi-hop and WSOL close/funding, then restarts without a duplicate liquidity effect', async () => {
  const load = (name: string) =>
      JSON.parse(
        gunzipSync(
          readFileSync(
            new URL(
              '../../../../docs/linked-pair-20261021/external-flow-completion/' + name,
              import.meta.url,
            ),
          ),
        ).toString(),
      ) as ProviderInterval,
    a = load('provider-459758217-459758224.json.gz'),
    b = load('provider-459758224-459758238.json.gz'),
    branch = newLinkedBranch('a', 'r', a.before);
  branch.simulated = (
    await transitionLinkedSnapshot(branch.simulated, 10000000n, true, {
      nowMs: Date.parse(a.before.observedAt),
      maxAgeMs: 10000,
    })
  ).next;
  const first = await reconcileLinkedInterval(branch, a, Date.parse(a.after.observedAt), 10000);
  expect(first.events).toBe(2);
  const restarted = JSON.parse(JSON.stringify(first.branch));
  const second = await reconcileLinkedInterval(restarted, b, Date.parse(b.after.observedAt), 10000);
  expect(second.events).toBe(5);
  expect(second.branch.real).toEqual(b.after);
  expect(second.branch.simulated.accounts[b.before.bridgePool]).not.toEqual(
    b.after.accounts[b.before.bridgePool],
  );
  expect(second.branch.intervals).toHaveLength(2);
  expect(
    Object.entries(second.branch.inventoryDeltas).some(
      ([k, v]) => k.startsWith('lamports:') && v !== '0',
    ),
  ).toBe(true);
  const duplicate = await reconcileLinkedInterval(
    JSON.parse(JSON.stringify(second.branch)),
    b,
    Date.parse(b.after.observedAt),
    10000,
  );
  expect(duplicate.replay).toBe(true);
  expect(duplicate.branch).toEqual(second.branch);
});

it('persists the native reserve across unsynced funding and a later SyncNative transaction', () => {
  const s = JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            '../../../../docs/linked-pair-20261021/external-flow-completion/provider-459758224-459758238.json.gz',
            import.meta.url,
          ),
        ),
      ).toString(),
    ).before,
    keys = [
      'wallet',
      'old',
      'new',
      WRAPPED_SOL_MINT,
      SPL_TOKEN_PROGRAM_ID,
      '11111111111111111111111111111111',
    ],
    rent = 1488440,
    meta = {
      err: null,
      fee: 0,
      preBalances: [10000000, rent, 0, 0, 0, 0],
      postBalances: [9999000, rent + 1000, 0, 0, 0, 0],
      preTokenBalances: [
        { accountIndex: 1, mint: WRAPPED_SOL_MINT, uiTokenAmount: { amount: '0' } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: WRAPPED_SOL_MINT, uiTokenAmount: { amount: '0' } },
      ],
      innerInstructions: [],
    },
    t = {
      version: 0,
      transaction: {
        signatures: ['controlled-funding'],
        message: { accountKeys: keys, instructions: [] },
      },
      meta,
    } as Receipt,
    deltas: Record<string, string> = { 'lamports:wallet': '10' },
    reserves: Record<string, string> = {},
    tokens = new Map([['old', 0n]]),
    first = new WrappedSolFlow(t, keys, deltas, new Set(), s, reserves),
    ix = system([0, 1], 1000n);
  first.instruction(ix, Buffer.from(bs58.decode(ix.data)), 1, [], tokens);
  first.verify(tokens);
  expect(reserves.old).toBe(String(rent));
  const next = {
      ...t,
      meta: {
        ...meta,
        preBalances: meta.postBalances,
        postBalances: meta.postBalances,
        postTokenBalances: [
          { accountIndex: 1, mint: WRAPPED_SOL_MINT, uiTokenAmount: { amount: '1000' } },
        ],
      },
    },
    restarted = new WrappedSolFlow(
      next,
      keys,
      JSON.parse(JSON.stringify(deltas)),
      new Set(),
      s,
      JSON.parse(JSON.stringify(reserves)),
    );
  restarted.instruction(
    { programIdIndex: 4, accounts: [1], data: '' },
    Buffer.from([17]),
    1,
    [],
    tokens,
  );
  expect(tokens.get('old')).toBe(1000n);
  restarted.verify(tokens);
});
