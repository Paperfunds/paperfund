/** Native reserved-fee withdrawal. No swap, price input, ledger effect or RPC. */
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  PUMP_AMM_PROGRAM_ID,
  decodePumpSwapPool,
  pumpSwapGlobalConfigAddress,
} from '../../src/pump-swap.js';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import type { Instruction } from './external-flow.js';
import { validatePumpPool } from './engine.js';
const program = new PublicKey(PUMP_AMM_PROGRAM_ID);
const discriminator = (name: string) =>
  createHash('sha256')
    .update('global:' + name)
    .digest()
    .subarray(0, 8);
export function pumpSweepBucket(ix: Instruction, keys: string[]): 'protocol' | 'creator' | null {
  if (keys[ix.programIdIndex] !== PUMP_AMM_PROGRAM_ID) return null;
  const raw = Buffer.from(bs58.decode(ix.data));
  if (raw.subarray(0, 8).equals(discriminator('sweep_protocol_fee'))) return 'protocol';
  if (raw.subarray(0, 8).equals(discriminator('sweep_creator_fee'))) return 'creator';
  return null;
}
export async function transitionPumpSweep(
  snapshot: Stage1Snapshot,
  ix: Instruction,
  keys: string[],
) {
  const bucket = pumpSweepBucket(ix, keys),
    a = ix.accounts.map((i) => keys[i]!);
  if (!bucket || Buffer.from(bs58.decode(ix.data)).length !== 8 || a.length !== 12)
    throw Error('PUMP_SWEEP_LAYOUT');
  const account = snapshot.accounts[a[2]!];
  if (account?.owner !== PUMP_AMM_PROGRAM_ID) throw Error('PUMP_SWEEP_POOL_MISSING');
  const raw = Buffer.from(account.base64, 'base64'),
    pool = decodePumpSwapPool(raw);
  const { math } = await validatePumpPool(snapshot, a[2]!, pool.baseMint, pool.quoteMint);
  const global = await pumpSwapGlobalConfigAddress(),
    mint = snapshot.accounts[pool.quoteMint];
  const event = PublicKey.findProgramAddressSync(
    [Buffer.from('__event_authority')],
    program,
  )[0].toBase58();
  if (
    a[1] !== global ||
    a[3] !== pool.quoteMint ||
    a[4] !== mint?.owner ||
    a[5] !== pool.quoteVault ||
    a[8] !== PublicKey.default.toBase58() ||
    a[9] !== 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' ||
    a[10] !== event ||
    a[11] !== PUMP_AMM_PROGRAM_ID
  )
    throw Error('PUMP_SWEEP_BINDING');
  const globalBytes = Buffer.from(snapshot.accounts[global]!.base64, 'base64');
  const protocolRecipients = Array.from({ length: 8 }, (_, i) =>
    new PublicKey(globalBytes.subarray(57 + i * 32, 89 + i * 32)).toBase58(),
  );
  const creatorVault = PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), new PublicKey(pool.coinCreator).toBuffer()],
    program,
  )[0].toBase58();
  if (bucket === 'protocol' ? !protocolRecipients.includes(a[6]!) : a[6] !== creatorVault)
    throw Error('PUMP_SWEEP_RECIPIENT');
  const recipientAta = getAssociatedTokenAddressSync(
    new PublicKey(pool.quoteMint),
    new PublicKey(a[6]!),
    true,
    new PublicKey(a[4]!),
  ).toBase58();
  if (a[7] !== recipientAta || a[7] === pool.quoteVault) throw Error('PUMP_SWEEP_RECIPIENT_ATA');
  const amount = bucket === 'protocol' ? math.protocolBucket : math.creatorBucket;
  const nextVirtual = math.virtual + amount;
  if (
    amount < 0n ||
    amount > math.quote ||
    nextVirtual < -(1n << 127n) ||
    nextVirtual >= 1n << 127n
  )
    throw Error('PUMP_SWEEP_RANGE');
  const next = structuredClone(snapshot),
    vault = Buffer.from(next.accounts[pool.quoteVault]!.base64, 'base64');
  vault.writeBigUInt64LE(math.quote - amount, 64);
  const unsigned = BigInt.asUintN(128, nextVirtual);
  raw.writeBigUInt64LE(unsigned & ((1n << 64n) - 1n), 245);
  raw.writeBigUInt64LE(unsigned >> 64n, 253);
  raw.writeBigUInt64LE(0n, bucket === 'protocol' ? 271 : 279);
  next.accounts[a[2]!] = { ...account, base64: raw.toString('base64') };
  next.accounts[pool.quoteVault] = {
    ...next.accounts[pool.quoteVault]!,
    base64: vault.toString('base64'),
  };
  await validatePumpPool(next, a[2]!, pool.baseMint, pool.quoteMint);
  return { next, amount, from: pool.quoteVault, to: recipientAta, bucket };
}
