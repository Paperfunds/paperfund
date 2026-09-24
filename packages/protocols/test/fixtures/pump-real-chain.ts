import { identifier, utcInstant } from '@paperfund/core';
import type { MarketState } from '@paperfund/execution';

import {
  PUMP_FUN_ADAPTER_VERSION,
  PUMP_FUN_NORMALIZATION_VERSION,
  PUMP_FUN_PROTOCOL_ID,
  PUMP_PROGRAM_ID,
} from '../../src/pump-fun.js';

/**
 * Sanitized mainnet snapshots captured with getMultipleAccounts at confirmed
 * commitment on 2026-09-24. No provider credential or private data is stored.
 * Addresses were discovered from Pump's public frontend API and verified from
 * the program-owned PDA data. Fee rates were decoded from Pump Fees account
 * 8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt in the same contextual read.
 */
export const RECORDED_PUMP_FIXTURES = {
  early: {
    mint: '6pobtrZo2hS8ntAwXsP7283ye6oTGdrVj7RqghYQpump',
    market: 'B2UzjQFky7BaEBRxwquZ3g3J9pR76obA1HRNMf8uEnvM',
    slot: 450076965n,
    curveBase64:
      'F7f4N2DYrGBm56vmzs8DAFwESfwGAAAAZk+Zmj3RAgBcWCUAAAAAAACAxqR+jQMAAPXpc0SA3WUzqVN4rNdPfwGPA0sN2D5AWyOq2HAHWP09AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    reserves: {
      virtualToken: 1_072_912_470_370_150n,
      virtualSol: 30_002_447_452n,
      realToken: 793_012_470_370_150n,
      realSol: 2_447_452n,
      mintSupply: 1_000_000_000_000_000n,
    },
  },
  developed: {
    mint: 'BewoWqr56gfPQXzWiMUSCVY4fJbthPZrdj17L3qCXEmg',
    market: '5mYpUpkKSpEcCgEqEx2ZVaebqa5NzTwaAaozFwCJBgmw',
    slot: 450076965n,
    curveBase64:
      'F7f4N2DYrGBPDFlx3AcCAGj+tRwNAAAAT3RGJUsJAQBoUpIgBgAAAACAxqR+jQMAAFaF7zBwHISSTcefTMJrp22fO3cXiueO6ByZ3xltZ1OQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    reserves: {
      virtualToken: 571_593_329_282_127n,
      virtualSol: 56_316_264_040n,
      realToken: 291_693_329_282_127n,
      realSol: 26_316_264_040n,
      mintSupply: 999_998_182_012_963n,
    },
  },
  normal: {
    mint: 'B9uxGD4PDtQg2TbkFCtmeHKQEMFfX7QW3w945LNypump',
    market: '2Xeehg2ngRn61opXECHXabu5zLbvx4F5bEP149fsHTFY',
    slot: 450076965n,
    curveBase64:
      'F7f4N2DYrGAg3nUxss8DAKmjffwGAAAAIEZj5SDRAgCp91kAAAAAAACAxqR+jQMAAHZLfO1HmtDGfK7/elgwMBx2xBX/XgUOlEpk3jp9GFjQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    reserves: {
      virtualToken: 1_072_789_171_068_448n,
      virtualSol: 30_005_896_105n,
      realToken: 792_889_171_068_448n,
      realSol: 5_896_105n,
      mintSupply: 1_000_000_000_000_000n,
    },
  },
  completed: {
    mint: '3dkzYYNZvF9WNqqyJurNEYCZ8fPZXBd1cq2D3UM3pump',
    market: '9QhPFMw2uYJdeMRCHAgmznEPwWiPMHSK7K9E1h16Uz3q',
    slot: 450077014n,
    curveBase64:
      'F7f4N2DYrGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAxqR+jQMAASbR/FnYtlzbp207COUuVL/2RTn0YxhhiWbT1btkfBTzAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  },
} as const;

export type ActivePumpFixtureName = 'early' | 'developed' | 'normal';

export function recordedPumpState(name: ActivePumpFixtureName): MarketState {
  const fixture = RECORDED_PUMP_FIXTURES[name];
  const creator =
    name === 'early'
      ? 'HYwMLFDFkDH2YJWHBWfLMCvaTpCbfAa4VXXftu2QPPKJ'
      : name === 'developed'
        ? '6pkWpod2Ea872KKwkpytNdJQ3fPEUwE9DidA5M35SrUf'
        : '8xmsUhKzuVJTMQRmyvHo44KhJnsUwdoLqUbr8aWkzj2w';
  return {
    identity: {
      protocolId: PUMP_FUN_PROTOCOL_ID,
      marketId: identifier(fixture.market, 'MarketId'),
      tokenMint: identifier(fixture.mint, 'TokenMint'),
    },
    observedAt: utcInstant('2026-09-24T16:01:45.000Z'),
    chainSlot: fixture.slot,
    chainBlockId: null,
    adapterVersion: PUMP_FUN_ADAPTER_VERSION,
    normalizationVersion: PUMP_FUN_NORMALIZATION_VERSION,
    normalizedState: {
      model: 'PUMP_FUN_BONDING_CURVE',
      programId: PUMP_PROGRAM_ID,
      feeProgramId: 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',
      bondingCurveAddress: fixture.market,
      globalAddress: '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf',
      feeConfigAddress: '8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt',
      tokenMint: fixture.mint,
      tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      tokenDecimals: '6',
      quoteAsset: 'SOL',
      virtualTokenReserves: fixture.reserves.virtualToken.toString(),
      virtualSolReserves: fixture.reserves.virtualSol.toString(),
      realTokenReserves: fixture.reserves.realToken.toString(),
      realSolReserves: fixture.reserves.realSol.toString(),
      tokenTotalSupply: '1000000000000000',
      mintSupply: fixture.reserves.mintSupply.toString(),
      feeEvaluationMintSupply: '1000000000000000',
      complete: false,
      creator,
      isMayhemMode: false,
      isCashbackCoin: false,
      isHolderReward: name === 'developed',
      configuredCreatorFeeBps: '0',
      creatorFeeConfigurable: true,
      protocolFeeBps: '95',
      creatorFeeBps: '30',
      feeTierMarketCapLamportsThreshold: '0',
      feeConfigAccountLength: '4097',
    },
    rawSource: {
      source: 'recorded-mainnet-getMultipleAccounts',
      curveAccountBase64: fixture.curveBase64,
    },
  };
}
