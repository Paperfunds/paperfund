// Bounded read-only current-bank evidence experiment. No database writes or trades.
import fs from 'node:fs';
import { readSetting } from './common.mjs';
import { createProductionExecutionRouter } from '../../packages/protocols/src/production.js';
import {
  captureCutoffState,
  verifyCutoffCapture,
  type CutoffHeader,
  type CurrentCutoffCapture,
} from '../../packages/protocols/src/cutoff-capture.js';
import { FinalizedRpc } from '../../apps/api/isolated/verified-routes/finalized-connector.js';
const url = await readSetting('SOLANA_RPC_URL');
if (!url) throw Error('RPC_NOT_CONFIGURED');
const router = createProductionExecutionRouter({
    rpcUrl: url,
    rpcTimeoutMs: 3000,
    commitment: 'finalized',
  }),
  rpc = new FinalizedRpc(url, 5000);
const cutoff = new Date(Math.ceil(Date.now() / 3600000) * 3600000),
  dir = 'docs/reward-distribution-20261026/integration';
fs.mkdirSync(dir, { recursive: true });
const captures: CurrentCutoffCapture[] = [],
  errors: string[] = [];
const mint = '3JVd8Z3kEEXBaBoZo9rcWk4MHJPSUAf6zAjvAF5spump';
while (Date.now() < +cutoff + 15000) {
  if (Date.now() < +cutoff - 20000) {
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }
  try {
    const capture = await captureCutoffState(async () => {
      const identity = await router.mintResolver!(mint);
      return (await router.loadPositionRoute(identity)).state;
    });
    if (!captures.some((c) => c.hash === capture.hash)) {
      captures.push(capture);
      fs.writeFileSync(
        dir + '/bank-' + capture.hash + '.json',
        JSON.stringify(capture, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n',
        { flag: 'wx' },
      );
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'CAPTURE_FAILED');
  }
  await new Promise((r) => setTimeout(r, 400));
}
const headers = new Map<number, CutoffHeader>();
const qualified = [];
for (const capture of captures.filter(
  (c) => Date.parse(c.bankTime) < +cutoff && +cutoff - Date.parse(c.bankTime) <= 10000,
)) {
  try {
    const slot = Number(capture.evidence.chainSlot),
      slots = await rpc.call<number[]>('getBlocks', [slot, slot + 32, { commitment: 'finalized' }]);
    for (const s of slots) {
      if (!headers.has(s)) {
        const b = await rpc.call<Omit<CutoffHeader, 'slot'>>('getBlock', [
          s,
          {
            commitment: 'finalized',
            transactionDetails: 'none',
            rewards: false,
            maxSupportedTransactionVersion: 0,
          },
        ]);
        if (b) headers.set(s, { ...b, slot: s });
      }
    }
    const last = headers.get(slot),
      next = slots
        .slice(1)
        .map((s) => headers.get(s))
        .find((h) => h?.parentSlot === slot);
    if (last && next) {
      verifyCutoffCapture(capture, last, next, cutoff);
      qualified.push({ captureHash: capture.hash, last, next });
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'FRONTIER_FAILED');
  }
}
const out = {
  at: new Date().toISOString(),
  readOnly: true,
  cutoff: cutoff.toISOString(),
  mint,
  captures: captures.map((c) => ({
    hash: c.hash,
    slot: String(c.evidence.chainSlot),
    bankTime: c.bankTime,
  })),
  qualified,
  headers: [...headers.values()],
  errors,
  genuineTradingRoundQualified: false,
  financialAccepted: false,
  broadcast: false,
};
fs.writeFileSync(dir + '/live-cutoff.json', JSON.stringify(out, null, 2) + '\n');
console.log(
  JSON.stringify({
    captures: captures.length,
    qualified: qualified.length,
    errors: errors.length,
    readOnly: true,
  }),
);
