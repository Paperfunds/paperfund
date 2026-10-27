/** Genuine finalized PumpSwap evidence; cutoff clocks in integration tests are explicitly synthetic. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import type { ProviderInterval } from './external-flow.js';
import { linkedBindings } from './shared-bridge.js';
export const PUMP_BRIDGE = '6DNxwecbtdNNstpB5tdnxZsfGe3HmsNgEUZhdue4b1PH';
export const pumpInterval = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        '../../../../docs/linked-pair-20261021/pump-bridge/provider-459703404-459703413.json.gz',
        import.meta.url,
      ),
    ),
  ).toString(),
) as ProviderInterval;
export function pumpBank(): Stage1Snapshot {
  const s = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          '../../../../docs/linked-pair-20261021/alternatives-2026-10-21T15-43-34-646Z/alternative-atomic-bank.json.gz',
          import.meta.url,
        ),
      ),
    ).toString(),
  ).snapshot as Stage1Snapshot;
  const routes = linkedBindings(s).map((r) => ({ ...r, bridgePool: PUMP_BRIDGE }));
  return { ...s, bridgePool: PUMP_BRIDGE, linkedRoutes: routes } as Stage1Snapshot;
}
