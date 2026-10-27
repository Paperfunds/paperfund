import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import { APPROVED_NON_SOL_PUMPSWAP_ROUTES, parseEnvironment } from '@paperfund/config';
import { GenericCapability, genericCapabilityOptions } from '../../db/src/generic-capability.js';
import type { DatabaseService } from '@paperfund/db';
import { withGenericActor } from '../src/generic-access-context.js';
import { createProductionExecutionRouter } from '../src/production.js';
import type { Stage1Snapshot } from '../src/experimental/non-sol-pump-swap.js';
import { workingVectors } from './fixtures/stage2-working-vectors.js';
const admin = 'user:' + 'a'.repeat(64),
  ordinary = 'user:' + 'b'.repeat(64);
const before = JSON.parse(
  readFileSync(new URL('./fixtures/generic-pumpswap-before.json', import.meta.url), 'utf8'),
);
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL('./fixtures/generic-pumpswap-live/' + name + '.json', import.meta.url),
      'utf8',
    ),
  ).snapshot as Stage1Snapshot;
function policy(normalUserAccess?: boolean) {
  const record = {
    schema: 'GENERIC_OPERATOR_CONTROL_V1',
    mode: 'ENTRY',
    expiresAt: Date.now() + 900000,
  };
  const query = vi.fn(async (input: unknown) => ({
    rows:
      typeof input === 'object' &&
      input !== null &&
      (input as { text: string }).text.includes('from app_meta')
        ? [{ value: JSON.stringify(record) }]
        : [],
  }));
  const cap = new GenericCapability({ pool: { query } } as unknown as DatabaseService, {
    armed: true,
    entries: true,
    operatorIds: [admin],
    entrySeconds: 900,
    ...(normalUserAccess === undefined ? {} : { normalUserAccess }),
  });
  return { cap, query, record };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('requires a new explicit gate; a legacy active operator window grants nobody discovery or BUY by default', async () => {
  const { cap, query } = policy();
  for (const userId of [admin, ordinary]) {
    expect(await cap.status(userId)).toMatchObject({ entitled: false, entriesEnabled: false });
    expect(
      await withGenericActor({ userId, intent: 'BUY' }, () =>
        cap.resolve('new-mint', 'new-quote', false),
      ),
    ).toEqual({ discover: false, buy: false });
  }
  await expect(cap.control(admin, 'ENTRY')).rejects.toThrow('ENTRY_NOT_ARMED');
  expect(
    query.mock.calls.every(([input]) => typeof input !== 'string' || !input.startsWith('insert')),
  ).toBe(true);
  expect(
    genericCapabilityOptions({
      GENERIC_PUMPSWAP_ENABLED: true,
      GENERIC_PUMPSWAP_BUYS_ENABLED: true,
    }),
  ).toMatchObject({ normalUserAccess: false });
});
it('keeps administrative membership out of trading admission and permits arbitrary new supported market identities', async () => {
  const { cap } = policy(true);
  for (const userId of [admin, ordinary]) {
    const grant = await withGenericActor({ userId, intent: 'BUY' }, () =>
      cap.resolve('never-enrolled-target', 'never-enrolled-quote', false),
    );
    expect(grant).toMatchObject({ discover: true, buy: true });
    await expect(grant.authorizeLive!('BUY')).resolves.toBeUndefined();
    await expect(grant.authorizeLive!('SELL')).rejects.toThrow('READ_SCOPE');
  }
  expect((await cap.status(admin)).canControl).toBe(true);
  expect((await cap.status(ordinary)).canControl).toBe(false);
  await expect(cap.control(ordinary, 'HARD_STOP')).rejects.toThrow('ENTITLEMENT_REQUIRED');
});
it('config keeps the gate OFF for legacy settings and rejects unsafe arming', () => {
  const env = {
    DATABASE_URL: 'postgresql://fixture:fixture@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    GENERIC_PUMPSWAP_ENABLED: 'true',
    GENERIC_PUMPSWAP_BUYS_ENABLED: 'true',
    GENERIC_PUMPSWAP_OPERATOR_USER_IDS: JSON.stringify([admin]),
  };
  expect(parseEnvironment(env).GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED).toBe(false);
  expect(
    parseEnvironment({ ...env, GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED: 'true' })
      .GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED,
  ).toBe(true);
  expect(() =>
    parseEnvironment({ ...env, GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED: '1' }),
  ).toThrow();
  expect(() =>
    parseEnvironment({
      ...env,
      GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED: 'true',
      GENERIC_PUMPSWAP_ENABLED: 'false',
    }),
  ).toThrow();
});
it('expiry, malformed state, missing state and hard stop deny both identities; READ cannot execute a BUY', async () => {
  const { cap, record } = policy(true);
  for (const mode of ['HARD_STOP', 'BROKEN', 'ENTRY']) {
    record.mode = mode;
    record.expiresAt = Date.now() - 1;
    for (const userId of [admin, ordinary]) {
      expect((await cap.status(userId)).entriesEnabled).toBe(false);
      if (mode !== 'ENTRY')
        await expect(
          withGenericActor({ userId, intent: 'BUY' }, () => cap.resolve('new', 'quote', false)),
        ).rejects.toThrow('HARD_STOP');
    }
  }
  record.mode = 'ENTRY';
  record.expiresAt = Date.now() + 900000;
  const read = await withGenericActor({ userId: ordinary, intent: 'READ' }, () =>
    cap.resolve('new', 'quote', false),
  );
  await expect(read.authorizeLive!('BUY')).rejects.toThrow('READ_SCOPE');
  const absent = new GenericCapability(
    { pool: { query: async () => ({ rows: [] }) } } as unknown as DatabaseService,
    { armed: true, entries: true, normalUserAccess: true, operatorIds: [admin], entrySeconds: 900 },
  );
  for (const userId of [admin, ordinary])
    expect(await absent.status(userId)).toMatchObject({ mode: 'EXIT_ONLY', entriesEnabled: false });
});
it('native Pump.fun, SOL PumpSwap and five other unchanged financial branches are identical across roles', async () => {
  const a = await withGenericActor({ userId: admin, intent: 'BUY' }, () =>
    workingVectors(true, true),
  );
  const b = await withGenericActor({ userId: ordinary, intent: 'BUY' }, () =>
    workingVectors(true, true),
  );
  expect(a).toEqual(before.legacyRestrictedOn);
  expect(b).toEqual(a);
}, 15000);
const cases = [
  ['SPCX', 'shunghla-warm'],
  ['GOOGLx', 'qubit-cold'],
  ['PUMP', 'tusd-cold'],
  ['NVDAx cold unregistered target', 'nvda-cartridge-cold'],
  ['TSLAx', 'tesla-teslasi-cold'],
  ['emoji GOOGLx', 'emoji-cold'],
];
it.each(cases)(
  'identical canonical generic %s BUY and partial/full SELL outputs for controller and ordinary users',
  async (_label, name) => {
    const s = fixture(name!);
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(s.observedAt));
    let exposure = false;
    const db = {
      pool: {
        query: async (input: unknown) => {
          const c = input as { text: string };
          if (c.text.includes('from app_meta'))
            return {
              rows: [
                {
                  value: JSON.stringify({
                    schema: 'GENERIC_OPERATOR_CONTROL_V1',
                    mode: 'ENTRY',
                    expiresAt: Date.now() + 900000,
                  }),
                },
              ],
            };
          return {
            rows: exposure
              ? [
                  {
                    protocol: 'GENERIC_PUMP_SWAP',
                    evidence_protocol: 'GENERIC_PUMP_SWAP',
                    adapter: 'generic-pump-swap-orca-v1',
                    normalization: 'generic-pump-swap-accounts-v1',
                    mint: s.mint,
                    quote: s.quoteMint,
                    bridge: s.bridgePool,
                    target: s.targetPool,
                  },
                ]
              : [],
          };
        },
      },
    } as unknown as DatabaseService;
    const capability = new GenericCapability(db, {
      armed: true,
      entries: true,
      normalUserAccess: true,
      operatorIds: [admin],
      entrySeconds: 900,
    });
    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('dexscreener'))
        return new Response(
          JSON.stringify([
            {
              pairAddress: s.bridgePool,
              baseToken: { address: s.quoteMint },
              quoteToken: { address: 'So11111111111111111111111111111111111111112' },
            },
          ]),
        );
      const req = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          result: {
            context: { slot: s.slot },
            value: req.params[0].map((a: string) =>
              s.accounts[a]
                ? { owner: s.accounts[a]!.owner, data: [s.accounts[a]!.base64, 'base64'] }
                : null,
            ),
          },
        }),
      );
    });
    async function calculate(userId: string, catalog = false) {
      exposure = false;
      const router = createProductionExecutionRouter({
        rpcUrl: 'https://fixture.invalid',
        rpcTimeoutMs: 1000,
        commitment: 'confirmed',
        genericPumpSwapEnabled: true,
        genericPumpSwapBuysEnabled: true,
        genericAccessResolver: (mint, quote, settlement) =>
          capability.resolve(mint, quote, settlement),
        nonSolPumpSwapEnabled: catalog,
        nonSolPumpSwapRoutes: APPROVED_NON_SOL_PUMPSWAP_ROUTES,
      });
      const identity = {
        protocolId: identifier('SOLANA_ROUTE', 'ProtocolId'),
        marketId: identifier('solana-route:' + s.mint, 'MarketId'),
        tokenMint: identifier(s.mint, 'TokenMint'),
      };
      const loaded = await withGenericActor({ userId, intent: 'BUY' }, () =>
        router.loadPositionRoute(identity),
      );
      const request = {
        identity: loaded.route.executionIdentity,
        orderId: identifier('parity-order', 'OrderId'),
        executionId: identifier('parity-fill', 'ExecutionId'),
        executedAt: utcInstant(s.observedAt),
      };
      const buy = await loaded.adapter.simulateBuy(
        { ...request, requestedPaperSol: paperSolBaseUnits(100000000n) },
        loaded.state,
      );
      exposure = true;
      const sellState = await withGenericActor({ userId, intent: 'SELL' }, () =>
        router.loadPositionRoute(identity),
      );
      const exits = [];
      for (const percentage of [25n, 50n, 75n, 100n])
        exits.push(
          await sellState.adapter.simulateSell(
            {
              ...request,
              requestedTokenQuantity: tokenBaseUnits((buy.actualOutput.amount * percentage) / 100n),
            },
            sellState.state,
          ),
        );
      return { protocol: loaded.route.executionIdentity.protocolId, buy, exits };
    }
    const op = await calculate(admin),
      normal = await calculate(ordinary);
    expect(normal).toEqual(op);
    expect(normal.protocol).toBe('GENERIC_PUMP_SWAP');
    if (name === 'shunghla-warm') {
      const original = structuredClone(s.accounts);
      const { orcaLink } = await import('../src/composed-pump-orca.js');
      for (const failure of ['unsupported-bridge-program', 'corrupt-ticks']) {
        s.accounts = structuredClone(original);
        if (failure === 'unsupported-bridge-program')
          s.accounts[s.bridgePool] = {
            ...s.accounts[s.bridgePool]!,
            owner: '11111111111111111111111111111111',
          };
        if (failure === 'corrupt-ticks') {
          const link = orcaLink(s.bridgePool, s.accounts[s.bridgePool]!);
          for (const address of link.extraAccounts ?? [])
            if (s.accounts[address])
              s.accounts[address] = {
                ...s.accounts[address]!,
                owner: '11111111111111111111111111111111',
              };
        }
        const reject = async (userId: string) => {
          try {
            await calculate(userId);
            throw Error('Unsafe acceptance: ' + failure);
          } catch (error) {
            if (!(error instanceof Error) || error.message.startsWith('Unsafe acceptance'))
              throw error;
            return error.message;
          }
        };
        expect(await reject(ordinary), failure).toBe(await reject(admin));
      }
      s.accounts = original;
    }
    if (['qubit-cold', 'tusd-cold', 'emoji-cold'].includes(name!)) {
      const a = await calculate(admin, true),
        b = await calculate(ordinary, true);
      expect(a).toEqual(b);
      expect(a.protocol).toBe('NON_SOL_PUMP_SWAP');
    }
  },
  15000,
);
