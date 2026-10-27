import { readFileSync } from 'node:fs';
import type { MarketState } from '@paperfund/execution';

export function recordedRoute(index: 0 | 1): MarketState {
  const json = JSON.parse(readFileSync(new URL(`./route-${index}.json`, import.meta.url), 'utf8'));
  return { ...json, chainSlot: BigInt(json.chainSlot) } as MarketState;
}
