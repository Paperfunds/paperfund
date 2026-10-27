import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { identifier } from '@paperfund/core';
import { PumpSwapSolanaMarketStateSource, PUMP_SWAP_PROTOCOL_ID, PUMP_AMM_PROGRAM_ID,
  pumpPoolAuthorityAddress, canonicalPumpSwapPoolAddress } from '../src/pump-swap.js';
import { PUMP_FEE_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID, WRAPPED_SOL_MINT, type SolanaRpcClient } from '../src/pump-fun.js';

describe('PumpSwap atomic snapshot boundary', () => {
  it('reads pool, fee config, mint and vault balances from one slot and accepts signed virtual reserves', async () => {
    const mint = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
    const pool = await canonicalPumpSwapPoolAddress(mint);
    const baseVault = '5jMpkf4JF4noHftLgNKyPNh6roVfPSGSjuEk3U4eLKRa';
    const quoteVault = '43DVcZR4kQFjh4Xm2i3DcneRxNjZp7HMud8yDrJWrDr8';
    const writeKey = (buffer: Buffer, offset: number, value: string) => new PublicKey(value).toBuffer().copy(buffer, offset);
    const poolData = Buffer.alloc(270);
    Buffer.from([241,154,109,4,17,177,109,188]).copy(poolData);
    writeKey(poolData, 11, await pumpPoolAuthorityAddress(mint));
    writeKey(poolData, 43, mint); writeKey(poolData, 75, WRAPPED_SOL_MINT);
    writeKey(poolData, 139, baseVault); writeKey(poolData, 171, quoteVault);
    // Signed i128 -100: low limb two's complement, upper limb all ones.
    poolData.writeBigUInt64LE((1n << 64n) - 100n, 245);
    poolData.writeBigUInt64LE((1n << 64n) - 1n, 253);
    const global = Buffer.alloc(321); Buffer.from([149,8,156,202,160,252,176,217]).copy(global);
    const fees = Buffer.alloc(109); Buffer.from([143,52,146,187,219,123,76,155]).copy(fees);
    fees.writeUInt32LE(1,65); fees.writeBigUInt64LE(25n,85);
    const mintData = Buffer.alloc(82); mintData.writeBigUInt64LE(1_000_000n,36); mintData[44]=6; mintData[45]=1;
    const vault = (assetMint: string, amount: bigint) => {
      const data=Buffer.alloc(165); writeKey(data,0,assetMint); writeKey(data,32,pool);
      data.writeBigUInt64LE(amount,64); data[108]=1; return data;
    };
    const account = (owner: string, data: Buffer) => ({ owner, data: [data.toString('base64'), 'base64'] as const });
    const batches: readonly string[][] = [];
    const mutableBatches = batches as string[][];
    const rpc = { async getMultipleAccounts(addresses: readonly string[]) {
      mutableBatches.push([...addresses]);
      if (addresses.length === 1) return { context: { slot: 1 }, value: [account(PUMP_AMM_PROGRAM_ID,poolData)] };
      return { context: { slot: 20 }, value: [account(PUMP_AMM_PROGRAM_ID,poolData), account(PUMP_AMM_PROGRAM_ID,global),
        account(PUMP_FEE_PROGRAM_ID,fees), account(SPL_TOKEN_PROGRAM_ID,mintData),
        account(SPL_TOKEN_PROGRAM_ID,vault(mint,100_000n)), account(SPL_TOKEN_PROGRAM_ID,vault(WRAPPED_SOL_MINT,10_000n))] };
    } } as SolanaRpcClient;
    const state = await new PumpSwapSolanaMarketStateSource(rpc).loadMarketState({ protocolId:PUMP_SWAP_PROTOCOL_ID,
      marketId:identifier(pool,'MarketId'), tokenMint:identifier(mint,'TokenMint') });
    expect(batches.map(batch=>batch.length)).toEqual([1,6]);
    expect(batches[1]?.slice(-2)).toEqual([baseVault,quoteVault]);
    expect(state.chainSlot).toBe(20n);
    expect(state.normalizedState).toMatchObject({ virtualQuoteReserves:'-100', effectiveQuoteReserves:'9900',
      stateSlots:{ configuration:'20', reserves:'20' } });
  });
});
