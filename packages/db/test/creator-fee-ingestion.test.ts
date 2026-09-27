import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID, WRAPPED_SOL_MINT } from '@paperfund/protocols';

import {
  parsePumpCreatorFeeEvents,
  SolanaPumpCreatorFeeSource,
  type CreatorFeeTransaction,
  type ReadOnlySolanaRpc,
} from '../src/index.js';

const PUMP_SIGNATURE =
  '3q1qyZGDbsaJPdswkoKWsWC38M8Qgk3gq1KYHmumwaQh1vtTkEHjuHJWH3AG4da9nFcXPTsi13ppjA52M7wJbC4f';
const PUMP_MINT = '5f3hEQy4H9UzhnzAhQfmfxnLEBHNnT4HrDP9ipPDpump';
const PUMP_CREATOR = 'ReM7jT2ofZPfvAwC6K5Hru9k64VJ5qsoEfzD8XhbUNP';
const PUMP_EVENT =
  'vdt/007mYe5FLd05sAoCohW3IzGlJypNY5TzKopwvcMl49szNtVrj9u2yBcAAAAAhfAfSLoMAAAANdjFdlRpksXfTXengQUtHORt/YuW52pjUoBSs3qO9Rk0dblqAAAAAEfk8QEHAAAAazsAy7rMAwBHOM4FAAAAAGuj7X4pzgIA4ATIfOuY+lzkf4A4Bv0seUXSlSSVmuwA3tl4FPOPeEZfAAAAAAAAAMHXOQAAAAAABlAq6JlhOTosYSC2nXldAIcTksSv5LHQftYlb3E+FvQeAAAAAAAAACJEEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAHNlbGwAAAAAAAAAAAAAAAAAAAAAAIgTAAAAAAAA4OscAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADbtsgXAAAAAEfk8QEHAAAARzjOBQAAAAAAAAAAAAAAAAAAAAAAAAAA';

const AMM_SIGNATURE =
  '492Pj4Lhk3ZucHNVDGYZyMpcKtrSLgqAvpDRccWWz1iXVNTb1HVFF4rqsP95suezqHU5iBEMAcpx7MRz1YkABEZu';
const AMM_POOL = '56hHQNSEg4xCH6g7d7fr3rKEW4wJEXNR9oYLVJEbMngM';
const AMM_MINT = '2zSroydg93rpA7poQjPwhCMAx6iW3HM6MuR4LrWopump';
const AMM_CREATOR = 'C5hsxNni8KFxdctqE5MDyoajTf5erg4Xk5ETeatGZabQ';
const AMM_EVENT =
  'Pi83CqUD3Cp0dblqAAAAADxPagEAAAAA95oCAAAAAACJbjMGAAAAAAAAAAAAAAAA2oUaCpUsAAAmlrekTwAAAISoAgAAAAAAFAAAAAAAAABdAQAAAAAAAAUAAAAAAAAAWAAAAAAAAAAnpwIAAAAAALShAgAAAAAAPOQzHXPhtBCN6Mb5PDgmz4iKAtL5h8wVph/VjhvH2d76p/lhiCKPuCtzaBlIULyEl45pcJo59dvzkuWN/TWAAdkzBZ18mxJUL1bj2CodKHwLPUUsbiysjRH9H0yKu/au0RuAKaQWyOmMsKc6JCAXzG3z7uGTfYKoek0n4k1wSRpKwvjQ3Vy8l+MonBl8tQYqVPPZVrnOblEV+WVnqlyz5nfZFZVfiIBzHOtKdaDMlsF0+kCVxOHZlnrPxChFrmeupKUZ1mUCUdQIenRVObf//wY9fzlv9PC5YRCz7+KvN/9LAAAAAAAAABsFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIgTAAAAAAAALAAAAAAAAADIQR4YBAAAAAAAAAAAAAAAAa4atI1giQMAAAAAAAAAAAAAAAAAAAAAAA==';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

function pda(seeds: readonly (string | Buffer)[], program: string) {
  return PublicKey.findProgramAddressSync(
    seeds.map((seed) => (typeof seed === 'string' ? new PublicKey(seed).toBuffer() : seed)),
    new PublicKey(program),
  )[0].toBase58();
}

const pumpCreatorVault = pda([Buffer.from('creator-vault'), PUMP_CREATOR], PUMP_PROGRAM_ID);
const pumpCreatorVaultAta = pda(
  [pumpCreatorVault, TOKEN_PROGRAM_ID, WRAPPED_SOL_MINT],
  ASSOCIATED_TOKEN_PROGRAM_ID,
);
const ammCreatorAuthority = pda([Buffer.from('creator_vault'), AMM_CREATOR], PUMP_AMM_PROGRAM_ID);
const ammCreatorVault = pda(
  [ammCreatorAuthority, TOKEN_PROGRAM_ID, WRAPPED_SOL_MINT],
  ASSOCIATED_TOKEN_PROGRAM_ID,
);

function transaction(input: {
  program: string;
  event: string;
  keys: readonly string[];
  accounts: readonly number[];
  discriminator: readonly number[];
  slot: number;
  blockTime: number;
  failed?: boolean;
}): CreatorFeeTransaction {
  return {
    slot: input.slot,
    blockTime: input.blockTime,
    meta: {
      err: input.failed ? { InstructionError: [0, 'fixture'] } : null,
      logMessages: [
        `Program ${input.program} invoke [1]`,
        `Program data: ${input.event}`,
        `Program ${input.program} success`,
      ],
      innerInstructions: [],
      loadedAddresses: { writable: [], readonly: [] },
    },
    transaction: {
      message: {
        accountKeys: input.keys,
        instructions: [
          {
            programIdIndex: 0,
            accounts: input.accounts,
            data: bs58.encode(Uint8Array.from(input.discriminator)),
          },
        ],
      },
    },
  };
}

const pumpTransaction = transaction({
  program: PUMP_PROGRAM_ID,
  event: PUMP_EVENT,
  keys: [
    PUMP_PROGRAM_ID,
    PUMP_MINT,
    WRAPPED_SOL_MINT,
    TOKEN_PROGRAM_ID,
    pumpCreatorVault,
    pumpCreatorVaultAta,
  ],
  accounts: [0, 1, 2, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 5],
  discriminator: [93, 246, 130, 60, 231, 233, 64, 178],
  slot: 451_097_471,
  blockTime: 1_790_539_060,
});

const ammTransaction = transaction({
  program: PUMP_AMM_PROGRAM_ID,
  event: AMM_EVENT,
  keys: [
    PUMP_AMM_PROGRAM_ID,
    AMM_POOL,
    AMM_MINT,
    WRAPPED_SOL_MINT,
    TOKEN_PROGRAM_ID,
    ammCreatorVault,
    ammCreatorAuthority,
  ],
  accounts: [1, 0, 0, 2, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 5, 6],
  discriminator: [51, 230, 133, 164, 1, 127, 131, 173],
  slot: 451_097_708,
  blockTime: 1_790_539_124,
});

describe('Phase 5E Pump creator-fee parsing', () => {
  it('decodes the exact creator fee from a real Pump.fun mainnet TradeEvent', () => {
    const events = parsePumpCreatorFeeEvents(PUMP_SIGNATURE, pumpTransaction, {
      tokenMint: PUMP_MINT,
      creatorWallet: PUMP_CREATOR,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      transactionSignature: PUMP_SIGNATURE,
      eventIndex: 1,
      slot: 451_097_471n,
      creatorFeeLamports: 1_197_090n,
      sourceProgram: PUMP_PROGRAM_ID,
      tokenProjectIdentity: PUMP_MINT,
      verificationStatus: 'VERIFIED',
    });
    expect(events[0]!.eventTime.toISOString()).toBe('2026-09-27T19:57:40.000Z');
  });

  it('binds a real PumpSwap mainnet SellEvent to its pool, mint, and SOL quote instruction', () => {
    const events = parsePumpCreatorFeeEvents(AMM_SIGNATURE, ammTransaction, {
      tokenMint: AMM_MINT,
      creatorWallet: AMM_CREATOR,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventIndex: 1,
      slot: 451_097_708n,
      creatorFeeLamports: 1_307n,
      sourceProgram: PUMP_AMM_PROGRAM_ID,
      tokenProjectIdentity: AMM_MINT,
    });
  });

  it('rejects unrelated identities, failed transactions, wrong programs, and non-SOL pools', () => {
    expect(
      parsePumpCreatorFeeEvents(PUMP_SIGNATURE, pumpTransaction, {
        tokenMint: PUMP_MINT,
        creatorWallet: AMM_CREATOR,
      }),
    ).toEqual([]);
    expect(
      parsePumpCreatorFeeEvents(
        PUMP_SIGNATURE,
        { ...pumpTransaction, meta: { ...pumpTransaction.meta!, err: 'failed' } },
        {
          tokenMint: PUMP_MINT,
          creatorWallet: PUMP_CREATOR,
        },
      ),
    ).toEqual([]);
    const wrongQuote = transaction({
      program: PUMP_AMM_PROGRAM_ID,
      event: AMM_EVENT,
      keys: [
        PUMP_AMM_PROGRAM_ID,
        AMM_POOL,
        AMM_MINT,
        PUMP_MINT,
        TOKEN_PROGRAM_ID,
        ammCreatorVault,
        ammCreatorAuthority,
      ],
      accounts: [1, 0, 0, 2, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 5, 6],
      discriminator: [51, 230, 133, 164, 1, 127, 131, 173],
      slot: 451_097_708,
      blockTime: 1_790_539_124,
    });
    expect(
      parsePumpCreatorFeeEvents(AMM_SIGNATURE, wrongQuote, {
        tokenMint: AMM_MINT,
        creatorWallet: AMM_CREATOR,
      }),
    ).toEqual([]);
    const wrongVault = transaction({
      program: PUMP_PROGRAM_ID,
      event: PUMP_EVENT,
      keys: [
        PUMP_PROGRAM_ID,
        PUMP_MINT,
        WRAPPED_SOL_MINT,
        TOKEN_PROGRAM_ID,
        PUMP_MINT,
        pumpCreatorVaultAta,
      ],
      accounts: [0, 1, 2, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 5],
      discriminator: [93, 246, 130, 60, 231, 233, 64, 178],
      slot: 451_097_471,
      blockTime: 1_790_539_060,
    });
    expect(
      parsePumpCreatorFeeEvents(PUMP_SIGNATURE, wrongVault, {
        tokenMint: PUMP_MINT,
        creatorWallet: PUMP_CREATOR,
      }),
    ).toEqual([]);
    const holderRewardEvent = Buffer.from(PUMP_EVENT, 'base64');
    holderRewardEvent.writeBigUInt64LE(1n, holderRewardEvent.length - 16);
    const holderRewards = transaction({
      program: PUMP_PROGRAM_ID,
      event: holderRewardEvent.toString('base64'),
      keys: [
        PUMP_PROGRAM_ID,
        PUMP_MINT,
        WRAPPED_SOL_MINT,
        TOKEN_PROGRAM_ID,
        pumpCreatorVault,
        pumpCreatorVaultAta,
      ],
      accounts: [0, 1, 2, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 5],
      discriminator: [93, 246, 130, 60, 231, 233, 64, 178],
      slot: 451_097_471,
      blockTime: 1_790_539_060,
    });
    expect(
      parsePumpCreatorFeeEvents(PUMP_SIGNATURE, holderRewards, {
        tokenMint: PUMP_MINT,
        creatorWallet: PUMP_CREATOR,
      }),
    ).toEqual([]);
  });

  it('fails closed without a complete funding identity and only returns finalized events from read()', async () => {
    const rpc: ReadOnlySolanaRpc = {
      async getSignaturesForAddress() {
        return [
          {
            signature: PUMP_SIGNATURE,
            slot: 451_097_471,
            err: null,
            blockTime: 1_790_539_060,
            confirmationStatus: 'confirmed',
          },
        ];
      },
      async getTransaction() {
        return pumpTransaction;
      },
      async getSignatureStatuses() {
        return [];
      },
      async getSlot() {
        return 451_097_500;
      },
    };
    expect(
      () =>
        new SolanaPumpCreatorFeeSource(rpc, { tokenMint: '', creatorWallet: '' }, 'mainnet-beta'),
    ).toThrow(/required/);
    const source = new SolanaPumpCreatorFeeSource(
      rpc,
      { tokenMint: PUMP_MINT, creatorWallet: PUMP_CREATOR },
      'mainnet-beta',
    );
    expect(await source.read()).toEqual([]);
  });
});
