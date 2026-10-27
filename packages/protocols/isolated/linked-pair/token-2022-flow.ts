/** Retained fee-policy witness; never substitutes a later account for historical liquidity. */
import { PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import {
  unpackMint,
  getExtensionTypes,
  getTransferFeeConfig,
  getEpochFee,
  calculateFee,
  ExtensionType,
  getTransferHook,
  getDefaultAccountState,
  TOKEN_2022_PROGRAM_ID,
  NATIVE_MINT_2022,
} from '@solana/spl-token';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import type { ProviderInterval } from './external-flow.js';
import bs58 from 'bs58';
import { epochProgression, type EpochWitness } from './epoch-flow.js';
import { ORCA_WHIRLPOOL_PROGRAM } from '../../src/composed-pump-orca.js';
const CLOCK = 'SysvarC1ock11111111111111111111111111111111';
export interface Token2022Evidence {
  schema: 'TOKEN_2022_FEE_SCHEDULE_WITNESS_V1';
  contextSlot: number;
  clock: { owner: string; base64: string };
  mints: Record<string, { owner: string; base64: string }>;
}
export function feePolicies(
  e: Token2022Evidence | undefined,
  before: Stage1Snapshot,
  after: Stage1Snapshot,
  blocks?: ProviderInterval['blocks'],
  epochWitness?: EpochWitness,
) {
  const result = new Map<string, { decimals: number; fee: (gross: bigint, epoch?: bigint) => bigint }>();
  if (!e) return result;
  const c = Buffer.from(e.clock?.base64 ?? '', 'base64'),
    old = Buffer.from(before.accounts[CLOCK]!.base64, 'base64');
  if (
    e.schema !== 'TOKEN_2022_FEE_SCHEDULE_WITNESS_V1' ||
    !Number.isSafeInteger(e.contextSlot) ||
    e.contextSlot < after.slot ||
    e.clock.owner !== 'Sysvar1111111111111111111111111111111111111' ||
    c.length !== 40 ||
    c.readBigUInt64LE(0) !== BigInt(e.contextSlot) ||
    old.length !== 40
  )
    throw Error('TOKEN_2022_WITNESS_CONTEXT');
  const epoch = old.readBigUInt64LE(16),
    observedEpoch = c.readBigUInt64LE(16);
  if (observedEpoch < epoch) throw Error('TOKEN_2022_WITNESS_EPOCH');
  const endClock = Buffer.from(after.accounts[CLOCK]!.base64, 'base64');
  if (endClock.length !== 40) throw Error('TOKEN_2022_WITNESS_CONTEXT');
  const endEpoch = endClock.readBigUInt64LE(16);
  if (endEpoch !== epoch) epochProgression(before, after, blocks ?? [], epochWitness);
  if (observedEpoch < endEpoch) throw Error('TOKEN_2022_WITNESS_EPOCH');
  for (const [address, a] of Object.entries(e.mints)) {
    if (a.owner !== TOKEN_2022_PROGRAM_ID.toBase58()) throw Error('TOKEN_2022_WITNESS_OWNER');
    const m = unpackMint(
      new PublicKey(address),
      {
        owner: TOKEN_2022_PROGRAM_ID,
        data: Buffer.from(a.base64, 'base64'),
        lamports: 0,
        executable: false,
        rentEpoch: 0,
      },
      TOKEN_2022_PROGRAM_ID,
    );
    const extensions = getExtensionTypes(m.tlvData);
    const transparent = extensions.some((t) => t !== ExtensionType.TransferFeeConfig);
    // Extension presence is not an executed extension instruction. Extended intermediary
    // mints require an exact transparent receipt proof, never a blanket extension opt-in.
    if (
      !m.isInitialized ||
      m.decimals > 18 ||
      extensions.some((t) => ![
        ExtensionType.TransferFeeConfig, ExtensionType.MintCloseAuthority,
        ExtensionType.PermanentDelegate, ExtensionType.DefaultAccountState,
        ExtensionType.ConfidentialTransferMint, ExtensionType.TransferHook,
        ExtensionType.MetadataPointer, ExtensionType.TokenMetadata,
      ].includes(t))
    )
      throw Error('TOKEN_2022_WITNESS_EXTENSIONS');
    const config = getTransferFeeConfig(m);
    if (transparent) {
      // Combined fee/extended policies are not covered by the zero-withholding proof.
      // A later mint witness describes its type, not its historical mutable hook state.
      if (config || !blocks || getTransferHook(m)?.programId.toBase58() &&
          getTransferHook(m)!.programId.toBase58() !== '11111111111111111111111111111111' ||
          getDefaultAccountState(m) && getDefaultAccountState(m)!.state !== 1)
        throw Error('TOKEN_2022_TRANSPARENT_PROOF_REQUIRED');
      proveTransparentMint(address, m.decimals, blocks);
    }
    if (config) {
      // A later two-entry schedule cannot prove a mutation inside this interval.
      for (const block of blocks ?? []) for (const tx of block.result.transactions) {
        if (tx.meta.err !== null) continue;
        const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
        for (const ix of [...tx.transaction.message.instructions, ...tx.meta.innerInstructions.flatMap(g=>g.instructions)]) {
          if (keys[ix.programIdIndex] !== TOKEN_2022_PROGRAM_ID.toBase58() || !ix.accounts.some(i=>keys[i]===address)) continue;
          const data = bs58.decode(ix.data);
          if (data[0] === 26 && data[1] === 5) throw Error('TOKEN_2022_POLICY_CHANGED_IN_INTERVAL');
        }
      }
      // Native SetTransferFee copies the active newer schedule to older and schedules at epoch+2.
      // A historical epoch before retained older is unprovable; never extrapolate backwards.
      if (
        config.olderTransferFee.epoch > epoch ||
        config.newerTransferFee.epoch < config.olderTransferFee.epoch ||
        config.olderTransferFee.epoch > observedEpoch ||
        config.newerTransferFee.epoch > observedEpoch + 2n ||
        [config.olderTransferFee, config.newerTransferFee].some(
          (f) => f.transferFeeBasisPoints > 10000,
        )
      )
        throw Error('TOKEN_2022_POLICY_HISTORY_UNAVAILABLE');
      result.set(address, { decimals: m.decimals, fee: (g, atEpoch = epoch) => {
        if (atEpoch < epoch || atEpoch > endEpoch) throw Error('TOKEN_2022_FEE_EPOCH_OUTSIDE_PROOF');
        return calculateFee(getEpochFee(config, atEpoch), g);
      } });
    } else result.set(address, { decimals: m.decimals, fee: () => 0n });
  }
  return result;
}
export const WITHHELD_PREFIX = 'withheld:';

/** Executed, successful TransferChecked semantics only. No historical account substitution.
 * Complete CPI ancestry excludes hooks; exact per-account conservation proves zero withholding
 * for positive transfers (hence zero for counterfactual amounts under that executed policy).
 * New nonnative accounts require successful System creation followed by exact initialization.
 * Confidential operations, delegation/state changes, close/recreation and missing history reject.
 */
export function proveTransparentMint(mint: string, decimals: number, blocks: ProviderInterval['blocks']) {
  let transfers = 0;
  for (const block of blocks) for (const tx of block.result.transactions) {
    if (tx.meta.err !== null) continue;
    const keys = [...tx.transaction.message.accountKeys,
      ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
    if (!keys.includes(mint) && !tx.meta.preTokenBalances.some((b) => b.mint === mint) &&
        !tx.meta.postTokenBalances.some((b) => b.mint === mint)) continue;
    const balances = [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances]
      .filter((b) => b.mint === mint);
    const accounts = new Set(balances.map((b) => keys[b.accountIndex]!));
    const flat: { ix: typeof tx.transaction.message.instructions[number]; depth: number }[] = [];
    for (const [index, ix] of tx.transaction.message.instructions.entries()) {
      flat.push({ ix, depth: 1 });
      for (const inner of tx.meta.innerInstructions.find((g) => g.index === index)?.instructions ?? []) {
        if (!Number.isSafeInteger(inner.stackHeight) || inner.stackHeight! < 2)
          throw Error('TOKEN_2022_TRANSPARENT_ANCESTRY');
        flat.push({ ix: inner, depth: inner.stackHeight! });
      }
    }
    const initializedHere=new Set(flat.filter(({ix})=>keys[ix.programIdIndex]===TOKEN_2022_PROGRAM_ID.toBase58() &&
      ix.accounts.length===2 && keys[ix.accounts[1]!]===mint && bs58.decode(ix.data).length===33 && bs58.decode(ix.data)[0]===18).map(({ix})=>keys[ix.accounts[0]!]!));
    for(const a of initializedHere)accounts.add(a);
    if (!accounts.size && !flat.some(({ix}) => ix.accounts.some((i) => keys[i] === mint))) continue;
    const actual = new Map<string, bigint>();
    const pending = new Set<string>();
    const created = new Set<string>();
    const immutable = new Set<string>();
    const closing = new Set<string>(), closed = new Set<string>();
    const owners=new Map<string,string>(), closeAuthorities=new Map<string,string|null>();
    for (const a of accounts) {
      const pre = tx.meta.preTokenBalances.filter((b) => keys[b.accountIndex] === a);
      const post = tx.meta.postTokenBalances.filter((b) => keys[b.accountIndex] === a);
      const ephemeral=!pre.length&&!post.length&&initializedHere.has(a)&&tx.meta.preBalances?.[keys.indexOf(a)]===0&&tx.meta.postBalances?.[keys.indexOf(a)]===0;
      if (pre.length > 1 || post.length > 1 || (!post.length && pre.length !== 1 && !ephemeral) || [...pre, ...post].some((b) =>
          b.mint !== mint || b.programId !== TOKEN_2022_PROGRAM_ID.toBase58() ||
          (b.uiTokenAmount as {decimals?:number}).decimals !== decimals))
        throw new Error('TOKEN_2022_TRANSPARENT_BALANCE_COVERAGE', { cause: {
          signature: tx.transaction.signatures[0], mint, account: a,
          preEntries: pre.length, postEntries: post.length,
        } });
      if (pre.length) {
        if(pre[0]!.owner)owners.set(a,pre[0]!.owner);
        actual.set(a, BigInt(pre[0]!.uiTokenAmount.amount));
        if (!post.length) {
          const i=keys.indexOf(a);
          if (!pre[0]!.owner || mint===NATIVE_MINT_2022.toBase58() ||
              !Number.isSafeInteger(tx.meta.preBalances?.[i]) || tx.meta.preBalances![i]!<=0 ||
              tx.meta.postBalances?.[i]!==0) throw Error('TOKEN_2022_TRANSPARENT_BALANCE_COVERAGE');
          closing.add(a);
        }
      }
      else {
        const accountIndex = keys.indexOf(a);
        // Missing token metadata alone never proves a zero balance. Successful fresh
        // creation, program ownership and initialization must all follow in order.
        if (tx.meta.preBalances?.[accountIndex] !== 0 || (!ephemeral&&!post[0]!.owner) ||
            mint === NATIVE_MINT_2022.toBase58())
          throw new Error('TOKEN_2022_TRANSPARENT_CREATION_REQUIRED', {cause:{signature:tx.transaction.signatures[0],mint,account:a,preLamports:tx.meta.preBalances?.[accountIndex]}});
        pending.add(a);
        if(ephemeral)closing.add(a);
      }
    }
    for (const [index, {ix, depth}] of flat.entries()) {
      const addresses = ix.accounts.map((i) => keys[i]!);
      if (addresses.some(a=>closed.has(a))) throw Error('TOKEN_2022_TRANSPARENT_CLOSED_ACCOUNT_REUSED');
      if (keys[ix.programIdIndex] === '11111111111111111111111111111111' &&
          addresses.some(a => pending.has(a))) {
        const raw = Buffer.from(bs58.decode(ix.data)), a = addresses[1];
        let amount: bigint | undefined, space: bigint | undefined, owner: Buffer | undefined;
        if(raw.length===52 && raw.readUInt32LE(0)===0 && addresses.length===2){
          amount=raw.readBigUInt64LE(4);space=raw.readBigUInt64LE(12);owner=raw.subarray(20,52);
        } else if(raw.length>=92 && raw.readUInt32LE(0)===3 && addresses.length===3){
          const length=raw.readBigUInt64LE(36);
          if(length<=32n && raw.length===92+Number(length)){
            const n=Number(length),base=raw.subarray(4,36),seed=raw.subarray(44,44+n);
            owner=raw.subarray(60+n,92+n);amount=raw.readBigUInt64LE(44+n);space=raw.readBigUInt64LE(52+n);
            if(new PublicKey(base).toBase58()!==addresses[2] ||
                !Buffer.from(seed.toString('utf8'),'utf8').equals(seed) ||
                new PublicKey(createHash('sha256').update(Buffer.concat([base,seed,owner])).digest()).toBase58()!==a)
              throw Error('TOKEN_2022_TRANSPARENT_SEEDED_CREATION');
          }
        }
        if (amount===undefined || space===undefined || !owner ||
            !a || !pending.has(a) || created.has(a) || actual.has(a) ||
            amount === 0n || space < 165n || space > 10485760n ||
            new PublicKey(owner).toBase58() !== TOKEN_2022_PROGRAM_ID.toBase58() ||
            !Number.isSafeInteger(tx.meta.postBalances?.[keys.indexOf(a)]) ||
            (BigInt(tx.meta.postBalances![keys.indexOf(a)]!) !== amount && !closing.has(a)))
          throw Error('TOKEN_2022_TRANSPARENT_CREATION_REQUIRED');
        created.add(a);
        continue;
      }
      if (keys[ix.programIdIndex] !== TOKEN_2022_PROGRAM_ID.toBase58()) continue;
      if (!addresses.some((a) => a === mint || accounts.has(a))) continue;
      const raw = Buffer.from(bs58.decode(ix.data));
      if(raw[0]===6 && raw[1]===3 && addresses.length===2 && actual.has(addresses[0]!) &&
          ((raw.length===3 && raw[2]===0)||(raw.length===35 && raw[2]===1)) &&
          addresses[1]===(closeAuthorities.get(addresses[0]!)??owners.get(addresses[0]!)) &&
          !(flat[index+1]&&flat[index+1]!.depth>depth)){
        // Native SetAuthority(CloseAccount) changes neither token amount, mint,
        // transfer-fee policy nor owner. Retain its exact new closure authority.
        closeAuthorities.set(addresses[0]!,raw[2]===0?null:new PublicKey(raw.subarray(3)).toBase58());
        continue;
      }
      if (raw[0]===9 && raw.length===1 && addresses.length===3 && closing.has(addresses[0]!) &&
          actual.get(addresses[0]!)===0n && addresses[0]!==addresses[1] &&
          addresses[1]===addresses[2] && addresses[2]===(closeAuthorities.get(addresses[0]!)??owners.get(addresses[0]!)) &&
          !(flat[index+1] && flat[index+1]!.depth>depth)) {
        const pre=tx.meta.preBalances,post=tx.meta.postBalances,fee=tx.meta.fee,i=keys.indexOf(addresses[0]!),d=keys.indexOf(addresses[1]!);
        if (!pre || !post || pre.length!==keys.length || post.length!==keys.length ||
            !Number.isSafeInteger(fee) || fee!<0 || [...pre,...post].some(n=>!Number.isSafeInteger(n)||n<0) ||
            post.reduce((s,n)=>s+BigInt(n),0n)-pre.reduce((s,n)=>s+BigInt(n),0n)!==-BigInt(fee!) || post[i]!==0 || d<0)
          throw Error('TOKEN_2022_TRANSPARENT_CLOSE_LAMPORTS');
        // Successful native Token-2022 CloseAccount proves the specified refund.
        // Other program credits may also reach the owner; never treat their net
        // balance difference as the close amount or as token liquidity.
        closed.add(addresses[0]!);
        continue;
      }
      // GetAccountDataSize is read-only. No other Token-2022 mutation is inferred.
      if (raw[0] === 21 && addresses.length === 1 && addresses[0] === mint) continue;
      if (raw[0] === 22 && raw.length === 1 && addresses.length === 1 &&
          pending.has(addresses[0]!) && created.has(addresses[0]!) &&
          !actual.has(addresses[0]!) && !immutable.has(addresses[0]!)) {
        immutable.add(addresses[0]!);
        continue;
      }
      if (raw[0] === 18 && raw.length === 33 && addresses.length === 2 &&
          addresses[1] === mint && pending.has(addresses[0]!) &&
          created.has(addresses[0]!) && !actual.has(addresses[0]!)) {
        actual.set(addresses[0]!, 0n);
        owners.set(addresses[0]!,new PublicKey(raw.subarray(1)).toBase58());
        continue;
      }
      if (raw.length !== 10 || raw[0] !== 12 || addresses[1] !== mint || raw[9] !== decimals)
        throw Error('TOKEN_2022_TRANSPARENT_INSTRUCTION:' + raw[0]);
      if (flat[index + 1] && flat[index + 1]!.depth > depth)
        throw Error('TOKEN_2022_TRANSPARENT_HOOK_CPI');
      const [from, , to] = addresses, amount = raw.readBigUInt64LE(1);
      if (!actual.has(from!) || !actual.has(to!) || actual.get(from!)! < amount)
        throw Error('TOKEN_2022_TRANSPARENT_TRANSFER_COVERAGE');
      // Native self-transfer validates ownership/funds but changes no balance.
      // It cannot establish a zero-withholding policy for other transfers.
      if(from===to)continue;
      actual.set(from!, actual.get(from!)! - amount);
      actual.set(to!, actual.get(to!)! + amount);
      if (amount > 0n) transfers++;
    }
    if ([...pending].some(a => !actual.has(a)))
      throw Error('TOKEN_2022_TRANSPARENT_CREATION_REQUIRED');
    if ([...closing].some(a=>!closed.has(a))) throw Error('TOKEN_2022_TRANSPARENT_CLOSE_PROOF');
    for (const [a, amount] of actual) {
      if (closed.has(a)) { if(amount!==0n)throw Error('TOKEN_2022_TRANSPARENT_CLOSE_PROOF'); continue; }
      if(owners.has(a) && owners.get(a)!==tx.meta.postTokenBalances.find(b=>keys[b.accountIndex]===a)!.owner)
        throw Error('TOKEN_2022_TRANSPARENT_OWNER_MISMATCH');
      if (amount !== BigInt(tx.meta.postTokenBalances.find((b) => keys[b.accountIndex] === a)!.uiTokenAmount.amount))
        throw Error('TOKEN_2022_TRANSPARENT_NET_MISMATCH:' + tx.transaction.signatures[0] + ':' + a);
    }
  }
  if (!transfers) throw Error('TOKEN_2022_TRANSPARENT_TRANSFER_MISSING');
  return { transfers, withheld: '0' as const };
}
export function requiredTokenFeeMints(before: Stage1Snapshot, blocks: ProviderInterval['blocks']) {
  const pools = new Set([
      before.targetPool,
      before.bridgePool,
      ...Object.entries(before.accounts)
        .filter(
          ([, a]) =>
            [
              'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
              '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
            ].includes(a.owner) &&
            [166, 287, 300, 301].includes(Buffer.from(a.base64, 'base64').length),
        )
        .map(([k]) => k),
    ]),
    mints = new Set<string>();
  for (const b of blocks)
    for (const t of b.result.transactions) {
      if (t.meta.err !== null) continue;
      const keys = [
        ...t.transaction.message.accountKeys,
        ...(t.meta.loadedAddresses?.writable ?? []),
        ...(t.meta.loadedAddresses?.readonly ?? []),
      ];
      if (![...t.transaction.message.instructions,...t.meta.innerInstructions.flatMap(g=>g.instructions)].some(ix=>[ORCA_WHIRLPOOL_PROGRAM,'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA','6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'].includes(keys[ix.programIdIndex]??'')&&ix.accounts.some(i=>pools.has(keys[i]!)))) continue;
      for (const ix of [
        ...t.transaction.message.instructions,
        ...t.meta.innerInstructions.flatMap((g) => g.instructions),
      ])
        if (
          keys[ix.programIdIndex] === TOKEN_2022_PROGRAM_ID.toBase58() &&
          Buffer.from(bs58.decode(ix.data))[0] === 12
        ) {
          const mint = keys[ix.accounts[1]!]!;
          if (!before.accounts[mint]) mints.add(mint);
        }
    }
  return [...mints].sort();
}
