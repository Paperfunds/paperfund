/** Isolated source candidate. A fresh atomic bank initializes a branch; never replaces one. */
import { pumpBondingCurveAddress, WRAPPED_SOL_MINT } from '../../src/pump-fun.js';
import {
  canonicalPumpSwapPoolAddress,
  decodePumpSwapPool,
  pumpSwapGlobalConfigAddress,
  pumpSwapFeeConfigAddress,
  PUMP_AMM_PROGRAM_ID,
} from '../../src/pump-swap.js';
import { LinkedEngine } from './engine.js';
import { linkedRoute, type RoutedSnapshot } from './shared-bridge.js';
interface RawAccount {
  owner: string;
  lamports?:number;
  data: [string, 'base64'];
}
export interface FinalizedPumpBank {
  commitment: 'finalized';
  context: { slot: number };
  value: (RawAccount | null)[];
}
export async function capturePumpLinkedGroup(
  read: (addresses: string[]) => Promise<FinalizedPumpBank>,
  mints: string[],
  quoteMint: string,
  bridgePool: string,
  now: () => number = Date.now,
) {
  if (
    mints.length < 1 ||
    new Set(mints).size !== mints.length ||
    mints.includes(quoteMint) ||
    quoteMint === WRAPPED_SOL_MINT
  )
    throw Error('LINKED_CAPTURE_GROUP');
  const pools = [
      ...(await Promise.all(mints.map((m) => canonicalPumpSwapPoolAddress(m, quoteMint)))),
      bridgePool,
    ],
    discovery = await read(pools);
  if (
    discovery.commitment !== 'finalized' ||
    discovery.value.length !== pools.length ||
    !Number.isSafeInteger(discovery.context.slot)
  )
    throw Error('LINKED_FINALIZED_DISCOVERY_REQUIRED');
  const vaults = discovery.value.flatMap((a) => {
    if (!a || a.owner !== PUMP_AMM_PROGRAM_ID) throw Error('LINKED_PUMP_POOL_REQUIRED');
    const p = decodePumpSwapPool(Buffer.from(a.data[0], 'base64'));
    return [p.baseVault, p.quoteVault];
  });
  const addresses = [
    ...new Set([
      ...pools,
      ...vaults,
      ...mints,
      quoteMint,
      WRAPPED_SOL_MINT,
      ...(await Promise.all([...mints, quoteMint].map(pumpBondingCurveAddress))),
      await pumpSwapGlobalConfigAddress(),
      await pumpSwapFeeConfigAddress(),
      'SysvarC1ock11111111111111111111111111111111',
    ]),
  ].sort();
  if (addresses.length > 100) throw Error('LINKED_ATOMIC_BANK_TOO_LARGE');
  const raw = await read(addresses);
  if (
    raw.commitment !== 'finalized' ||
    !Number.isSafeInteger(raw.context.slot) ||
    raw.context.slot < discovery.context.slot ||
    raw.value.length !== addresses.length
  )
    throw Error('LINKED_ATOMIC_BANK_REQUIRED');
  const snapshot: RoutedSnapshot = {
    version: 'NON_SOL_PUMPSWAP_STAGE1_V1',
    mint: mints[0]!,
    quoteMint,
    targetPool: pools[0]!,
    bridgePool,
    slot: raw.context.slot,
    observedAt: new Date(now()).toISOString(),
    accounts: Object.fromEntries(
      addresses.map((address, i) => {
        const a = raw.value[i];
        if (!a || a.data[1] !== 'base64') throw Error('LINKED_ATOMIC_DEPENDENCY_MISSING');
        return [address, { owner: a.owner, base64: a.data[0] }];
      }),
    ),
    absentAccounts: [],
    linkedRoutes: mints.map((mint, i) => ({ mint, quoteMint, targetPool: pools[i]!, bridgePool })),
  };
  const engine = new LinkedEngine({
    purpose: 'READ_ONLY_STAGE1_VALIDATION',
    bridgeBinding: { quoteMint, pool: bridgePool },
  });
  for (const mint of mints)
    await engine.validate(linkedRoute(snapshot, mint), { nowMs: now(), maxAgeMs: 10000 });
  return { snapshot, addresses, raw };
}
