import { PublicKey } from '@solana/web3.js';
/** Controlled native Orca swap and fee-tier fixture, never a mainnet transition claim. */
import bs58 from 'bs58';
import { compositeInterval, oldEvidence } from './remaining-fixtures.js';
import { mixedBank } from './mixed-fixtures.js';
import { linkedBindings } from './shared-bridge.js';
import {
  decodeSwap,
  type ProviderInterval,
  type Instruction,
  type Receipt,
} from './external-flow.js';
import { transitionLinkedLeg } from './native-transition.js';
import {
  WRAPPED_SOL_MINT,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '../../src/pump-fun.js';
import { ORCA_WHIRLPOOL_PROGRAM } from '../../src/composed-pump-orca.js';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
export function controlledAutomaticRoutes() {
  const root = compositeInterval().before,
    pump = mixedBank();
  for (const [a, v] of Object.entries(pump.accounts))
    if (!root.accounts[a]) root.accounts[a] = structuredClone(v);
  const routes = linkedBindings(root);
  const fee = '5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx',
    raw = Buffer.from(root.accounts[fee]!.base64, 'base64');
  for (let i = 0; i < raw.readUInt32LE(65); i++) raw.writeBigUInt64LE(500n, 69 + i * 40 + 24);
  root.accounts[fee] = { ...root.accounts[fee]!, base64: raw.toString('base64') };
  return {
    ...root,
    linkedRoutes: [...routes, ...routes.map((r) => ({ ...r, bridgePool: pump.bridgePool }))],
  };
}
export async function controlledOrcaMovement(
  s: Stage1Snapshot,
  amount = 5000000000n,
): Promise<ProviderInterval> {
  let ix: Instruction | undefined,
    keys: string[] = [];
  for (const b of oldEvidence.blocks)
    for (const t of b.result.transactions) {
      const k = [
        ...t.transaction.message.accountKeys,
        ...(t.meta.loadedAddresses?.writable ?? []),
        ...(t.meta.loadedAddresses?.readonly ?? []),
      ];
      for (const i of [
        ...t.transaction.message.instructions,
        ...t.meta.innerInstructions.flatMap((x) => x.instructions),
      ])
        if (k[i.programIdIndex] === ORCA_WHIRLPOOL_PROGRAM && k[i.accounts[4]!] === s.bridgePool) {
          ix = structuredClone(i);
          keys = k;
          break;
        }
    }
  if (!ix) throw Error('RETAINED_ORCA_INSTRUCTION_MISSING');
  const raw = Buffer.from(bs58.decode(ix.data));
  raw.writeBigUInt64LE(amount, 8);
  raw.writeBigUInt64LE(1n, 16);
  raw.fill(0, 24, 40);
  const aToB = keys[ix.accounts[5]!] === WRAPPED_SOL_MINT;
  raw[41] = aToB ? 1 : 0;
  ix.data = bs58.encode(raw);
  delete ix.stackHeight;
  const spec = decodeSwap(s, ix, keys);
  if (!spec || spec.pump || spec.curve || !('inputVault' in spec))
    throw Error('ORCA_INSTRUCTION_BINDING');
  const r = await transitionLinkedLeg(
      s,
      amount,
      true,
      { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 },
      'BRIDGE',
    ),
    mint = (address: string) => {
      const a = s.accounts[address];
      if (a && [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner)) {
        const b = Buffer.from(a.base64, 'base64');
        return new PublicKey(b.subarray(0, 32)).toBase58();
      }
      return address === spec.source ? WRAPPED_SOL_MINT : s.quoteMint;
    };
  const addresses = [spec.source, spec.inputVault, spec.outputVault, spec.destination],
    pre = new Map(
      addresses.map((address) => [
        address,
        {
          mint: mint(address),
          amount: s.accounts[address]
            ? Buffer.from(s.accounts[address]!.base64, 'base64').readBigUInt64LE(64)
            : address === spec.source
              ? 1000000000000n
              : 0n,
        },
      ]),
    ),
    post = structuredClone(pre),
    transfers = [
      { from: spec.source, to: spec.inputVault, amount },
      { from: spec.outputVault, to: spec.destination, amount: r.output },
    ];
  const inner: Instruction[] = [];
  for (const t of transfers) {
    post.get(t.from)!.amount -= t.amount;
    post.get(t.to)!.amount += t.amount;
    const d = Buffer.alloc(9);
    d[0] = 3;
    d.writeBigUInt64LE(t.amount, 1);
    const p = s.accounts[pre.get(t.from)!.mint]!.owner;
    if (!keys.includes(p)) keys.push(p);
    inner.push({
      programIdIndex: keys.indexOf(p),
      accounts: [keys.indexOf(t.from), keys.indexOf(t.to)],
      data: bs58.encode(d),
      stackHeight: 2,
    });
  }
  const balances = (m: typeof pre) =>
      [...m].map(([a, v]) => ({
        accountIndex: keys.indexOf(a),
        mint: v.mint,
        uiTokenAmount: { amount: v.amount.toString() },
      })),
    native = (m: typeof pre) =>
      keys.map((a) => {
        const v = m.get(a);
        if (v?.mint !== WRAPPED_SOL_MINT) return 0;
        const b = Buffer.from(s.accounts[a]?.base64 ?? '', 'base64'),
          rent = b.length >= 121 && b.readUInt32LE(109) === 1 ? b.readBigUInt64LE(113) : 1488440n;
        return Number(v.amount + rent);
      }),
    receipt: Receipt = {
      version: 0,
      transaction: {
        signatures: ['CONTROLLED-ORCA-MOVE-' + s.slot],
        message: { accountKeys: keys, instructions: [ix] },
      },
      meta: {
        err: null,
        fee: 0,
        preBalances: native(pre),
        postBalances: native(post),
        preTokenBalances: balances(pre),
        postTokenBalances: balances(post),
        innerInstructions: [{ index: 0, instructions: inner }],
      },
    };
  const after = r.next,
    clock = 'SysvarC1ock11111111111111111111111111111111',
    c = Buffer.from(after.accounts[clock]!.base64, 'base64'),
    time = c.readBigInt64LE(32);
  after.slot++;
  c.writeBigUInt64LE(BigInt(after.slot), 0);
  after.accounts[clock] = { ...after.accounts[clock]!, base64: c.toString('base64') };
  after.observedAt = s.observedAt;
  return {
    schema: 'LINKED_RETAINED_RPC_INTERVAL_V1',
    commitment: 'finalized',
    before: structuredClone(s),
    after,
    acquiredAt: s.observedAt,
    slots: [after.slot],
    anchor: { blockhash: 'CONTROLLED-ORCA-before' },
    blocks: [
      {
        slot: after.slot,
        result: {
          parentSlot: s.slot,
          previousBlockhash: 'CONTROLLED-ORCA-before',
          blockhash: 'CONTROLLED-ORCA-after',
          blockTime: Number(time),
          transactions: [receipt],
        },
      },
    ],
  };
}
