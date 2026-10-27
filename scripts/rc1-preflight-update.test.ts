import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { buyPreflightMessage } from '../packages/shared/src/browser.js';
import { prepare } from './prepare-rc1-preflight-update.mjs';
it('corrects the reproduced RC1 warning without changing admission or the remaining frozen payload', async () => {
  const artifact = await prepare();
  const oldMessage = runInNewContext(`(${artifact.before})`);
  const newMessage = runInNewContext(`(${artifact.after})`);
  const evidence = JSON.parse(
    await readFile(
      new URL('../docs/linked-pair-20261021/preflight-before.json', import.meta.url),
      'utf8',
    ),
  );
  const linked = evidence.markets[0].data;
  const ordinary = evidence.markets[1].data;
  expect(linked).toMatchObject({
    equityValuationStatus: 'FULL',
    valuationStatus: 'AVAILABLE',
    blockingReason: 'GENERIC_OPERATOR_ENTRY_DISABLED',
    unavailablePositionIds: [],
  });
  expect(oldMessage(linked)).toContain('an open position');
  expect(newMessage(linked)).toBe(buyPreflightMessage(linked));
  expect(newMessage(linked)).toContain('generic-market entries are currently disabled');
  expect(newMessage(ordinary)).toBeNull();
  for (const preflight of [
    null,
    { ...linked, marketSupported: false, marketStatus: 'RPC_UNAVAILABLE' },
    {
      ...linked,
      blockingReason: 'PORTFOLIO_EQUITY_UNAVAILABLE',
      equityValuationStatus: 'UNAVAILABLE',
    },
    { ...ordinary, blockingReason: 'FUTURE_POLICY_BLOCK' },
    { ...ordinary, equityValuationStatus: 'PARTIAL_LIQUIDITY' },
    { ...ordinary, slotAvailable: false },
  ])
    expect(newMessage(preflight)).toBe(buyPreflightMessage(preflight));
  expect(
    artifact.files
      .filter((f: { before: string; after: string }) => f.before !== f.after)
      .map((f: { file: string }) => f.file)
      .sort(),
  ).toEqual(['content.js', 'manifest.json']);
});
