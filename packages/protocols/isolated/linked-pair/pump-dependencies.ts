/** Initial capture only. This does not refresh/replace an existing persisted paper branch. */
import { capturePumpLinkedGroup, type FinalizedPumpBank } from './pump-capture.js';
import { validatePumpPool } from './engine.js';
import {
  pumpBondingCurveAddress,
  pumpGlobalAddress,
  pumpFeeConfigAddress,
  PUMP_PROGRAM_ID,
} from '../../src/pump-fun.js';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import { decodePumpSwapPool, PUMP_AMM_PROGRAM_ID } from '../../src/pump-swap.js';
export interface PumpDependency {
  base: string;
  quote: string;
  pool: string;
  baseVault: string;
  quoteVault: string;
}
export async function capturePumpDependencies(
  read: (addresses: string[]) => Promise<FinalizedPumpBank>,
  mints: string[],
  quote: string,
  bridge: string,
  dependencies: PumpDependency[],
  now: () => number = Date.now,
) {
  const seed = await capturePumpLinkedGroup(read, mints, quote, bridge, now),
    addresses = [
      ...new Set([
        ...seed.addresses,
        await pumpGlobalAddress(),
        await pumpFeeConfigAddress(),
        'SysvarRent111111111111111111111111111111111',
        ...dependencies.flatMap((d) => [d.base, d.quote, d.pool, d.baseVault, d.quoteVault]),
        ...(await Promise.all(dependencies.map((d) => pumpBondingCurveAddress(d.base)))),
      ]),
    ].sort();
  if (addresses.length > 100) throw Error('MULTI_HOP_ATOMIC_DEPENDENCY_LIMIT');
  const raw = await read(addresses);
  if (
    raw.commitment !== 'finalized' ||
    raw.context.slot < seed.snapshot.slot ||
    raw.value.length !== addresses.length
  )
    throw Error('MULTI_HOP_ATOMIC_BANK_REQUIRED');
  const snapshot: Stage1Snapshot = {
    ...seed.snapshot,
    slot: raw.context.slot,
    observedAt: new Date(now()).toISOString(),
    accounts: Object.fromEntries(
      addresses.map((a, i) => {
        const r = raw.value[i];
        if (!r || r.data[1] !== 'base64') throw Error('MULTI_HOP_DEPENDENCY_MISSING:' + a);
        if(r.lamports!==undefined && (!Number.isSafeInteger(r.lamports)||r.lamports<0))throw Error('CURVE_NATIVE_UNSAFE_LAMPORT_EVIDENCE');
        return [a, { owner:r.owner,base64:r.data[0],...(r.owner===PUMP_PROGRAM_ID && r.lamports!==undefined?{lamports:String(r.lamports)}:{}) }];
      }),
    ),
  };
  for (const d of dependencies) {
    if (snapshot.accounts[d.pool]!.owner === PUMP_PROGRAM_ID) {
      if (d.pool !== (await pumpBondingCurveAddress(d.base)))
        throw Error('MULTI_HOP_CURVE_BINDING');
      continue;
    }
    if (snapshot.accounts[d.pool]!.owner !== PUMP_AMM_PROGRAM_ID)
      throw Error('MULTI_HOP_OWNER_UNSUPPORTED:' + d.pool);
    const p = decodePumpSwapPool(Buffer.from(snapshot.accounts[d.pool]!.base64, 'base64'));
    if (
      p.baseMint !== d.base ||
      p.quoteMint !== d.quote ||
      p.baseVault !== d.baseVault ||
      p.quoteVault !== d.quoteVault
    )
      throw Error('MULTI_HOP_DEPENDENCY_BINDING');
    await validatePumpPool(snapshot, d.pool, d.base, d.quote);
  }
  return { snapshot, addresses, raw };
}
