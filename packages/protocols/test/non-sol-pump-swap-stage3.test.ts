import { workingVectors } from './fixtures/stage2-working-vectors.js';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import {
  APPROVED_NON_SOL_PUMPSWAP_ROUTES,
  validateNonSolPumpSwapRoutes,
  parseEnvironment,
} from '@paperfund/config';
import { NonSolPumpSwapSource, assertNonSolRouteBinding } from '../src/non-sol-pump-swap.js';
import { createProductionExecutionRouter } from '../src/production.js';
import type { Stage1Snapshot } from '../src/experimental/non-sol-pump-swap.js';
const opts = {
  rpcUrl: 'https://example.invalid',
  rpcTimeoutMs: 1000,
  commitment: 'confirmed' as const,
};
const env = {
  DATABASE_URL: 'postgresql://fixture:fixture@localhost/test',
  REDIS_URL: 'redis://localhost:6379',
};
const snapshot = () =>
  JSON.parse(readFileSync(new URL('./fixtures/non-sol-stage1/qubit.json', import.meta.url), 'utf8'))
    .snapshot as Stage1Snapshot;
afterEach(() => vi.unstubAllGlobals());
it('fails closed when enabled without a complete exact server allowlist', () => {
  expect(() => createProductionExecutionRouter({ ...opts, nonSolPumpSwapEnabled: true })).toThrow(
    'ALLOWLIST_REQUIRED',
  );
  expect(() => parseEnvironment({ ...env, NON_SOL_PUMPSWAP_ENABLED: 'true' })).toThrow('allowlist');
  expect(parseEnvironment(env).NON_SOL_PUMPSWAP_ENABLED).toBe(false);
});
it.each([
  'targetPool',
  'bridgePool',
  'quoteMint',
  'targetProgram',
  'bridgeProgram',
  'targetBaseVault',
  'bridgeQuoteVault',
  'baseTokenProgram',
])('rejects wrong allowlist %s before execution', (key) => {
  const row = {
    ...APPROVED_NON_SOL_PUMPSWAP_ROUTES[0]!,
    [key]: '11111111111111111111111111111111',
  };
  expect(() => validateNonSolPumpSwapRoutes([row])).toThrow('IDENTITY_MISMATCH');
});
it('rejects incomplete, duplicate and non-approved identities', () => {
  expect(() =>
    validateNonSolPumpSwapRoutes([{ mint: APPROVED_NON_SOL_PUMPSWAP_ROUTES[0]!.mint }]),
  ).toThrow();
  expect(() =>
    validateNonSolPumpSwapRoutes([
      APPROVED_NON_SOL_PUMPSWAP_ROUTES[0],
      APPROVED_NON_SOL_PUMPSWAP_ROUTES[0],
    ]),
  ).toThrow();
  expect(() =>
    validateNonSolPumpSwapRoutes([
      { ...APPROVED_NON_SOL_PUMPSWAP_ROUTES[0]!, mint: '11111111111111111111111111111111' },
    ]),
  ).toThrow();
});
it('does not discover a non-allowlisted target merely because its quote is GOOGLx', async () => {
  const rpc = { getMultipleAccounts: vi.fn(async () => ({ context: { slot: 1 }, value: [] })) };
  const source = new NonSolPumpSwapSource(rpc, APPROVED_NON_SOL_PUMPSWAP_ROUTES);
  await expect(
    source.resolve(
      '11111111111111111111111111111111',
      APPROVED_NON_SOL_PUMPSWAP_ROUTES[0]!.quoteMint,
    ),
  ).rejects.toThrow('NOT_ALLOWLISTED');
  expect(rpc.getMultipleAccounts).not.toHaveBeenCalled();
});
it('enforces exact snapshot pool, bridge, quote and program bindings', () => {
  for (const key of ['targetPool', 'bridgePool', 'quoteMint'] as const) {
    const s = snapshot();
    s[key] = '11111111111111111111111111111111';
    expect(() => assertNonSolRouteBinding(s)).toThrow('ROUTE_MISMATCH');
  }
  const s = snapshot();
  s.accounts[s.targetPool] = {
    ...s.accounts[s.targetPool]!,
    owner: '11111111111111111111111111111111',
  };
  expect(() => assertNonSolRouteBinding(s)).toThrow('PROGRAM_MISMATCH');
});
it('rollback OFF rejects an existing economic position without modifying its history/quantity', async () => {
  const s = snapshot(),
    position = { mint: s.mint, quantity: '4304019538943', basis: '1000000000' },
    before = JSON.stringify(position);
  const fetch = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
    const r = JSON.parse(init!.body as string);
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          context: { slot: s.slot },
          value: r.params[0].map((a: string) =>
            s.accounts[a]
              ? { owner: s.accounts[a]!.owner, data: [s.accounts[a]!.base64, 'base64'] }
              : null,
          ),
        },
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  const router = createProductionExecutionRouter({
    ...opts,
    nonSolPumpSwapEnabled: false,
    nonSolPumpSwapRoutes: APPROVED_NON_SOL_PUMPSWAP_ROUTES,
  });
  await expect(router.mintResolver!(position.mint)).rejects.toMatchObject({
    code: 'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
  });
  expect(JSON.stringify(position)).toBe(before);
  expect(fetch.mock.calls.length).toBe(2);
});

it('keeps all seven enabled legacy branches identical even with the restricted capability ON', async () => {
  expect(await workingVectors(true)).toEqual(
    JSON.parse(
      readFileSync(new URL('./fixtures/non-sol-stage2-before.json', import.meta.url), 'utf8'),
    ),
  );
});
