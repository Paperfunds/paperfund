import {
  bytesHash,
  canonical,
  dayId,
  financial,
  hash,
  hourId,
  replayInput,
  SCOPE,
} from './contract.js';
import type { Account, Daily, Hour, Holds, MockPolicy, Plan, Ports, Proof } from './contract.js';
export function fixture(kind: 'HOURLY' | 'DAILY' = 'HOURLY', sourceAgeMs = 1000) {
  const start = Date.parse('2045-01-02T00:00:00.000Z'),
    now = start + 86400000 + 50000;
  const policy: MockPolicy = {
    approval: 'MOCK_APPROVAL_NOT_OPERATOR_AUTHORIZATION',
    model: 'MOCK_DIRECTIONAL_V2',
    policyHash: hash({ policy: 'MOCK_UNAPPROVED_TEST_ONLY' }),
    maxAgeMs: 4000,
    reserveMs: 1000,
    totalAgeMs: 5000,
    epsilonMs: 100,
    finalityWaitMs: 60000,
    healthAgeMs: 30000,
  };
  const hours = new Map<string, Hour>();
  for (let i = 0; i < (kind === 'DAILY' ? 24 : 1); i++) {
    const at = start + i * 3600000,
      C = at + 3600000,
      id = hourId(at),
      market = 'MOCK_SOL_TOKEN';
    const account: Account = {
      id: id + ':account',
      userId: 'MOCK_USER',
      starting: 10000000000n,
      quantity: 0n,
      basis: 0n,
      journals: [
        {
          id: id + ':credit',
          lines: [
            { account: 'CASH', side: 'DEBIT', amount: 10000000000n },
            { account: 'HOURLY_STARTING_CAPITAL', side: 'CREDIT', amount: 10000000000n },
          ],
        },
        {
          id: id + ':loss',
          lines: [
            { account: 'TRADING_PNL', side: 'DEBIT', amount: 40000000n },
            { account: 'CASH', side: 'CREDIT', amount: 40000000n },
          ],
        },
      ],
      result: { id: id + ':result', cash: 9960000000n, pnl: -40000000n },
    };
    const raw = canonical({
      market,
      slot: '100',
      sourceMs: C - sourceAgeMs,
      fxMs: C - sourceAgeMs,
      feeMs: C - sourceAgeMs,
      quoteMs: C - sourceAgeMs,
      rawAccounts: 'EXPLICIT_SYNTHETIC_NOT_MAINNET',
    });
    const capture = {
      id: id + ':capture',
      market,
      raw,
      slot: 100n,
      sourceMs: C - sourceAgeMs,
      fxMs: C - sourceAgeMs,
      feeMs: C - sourceAgeMs,
      quoteMs: C - sourceAgeMs,
      certifiedMs: C - 500,
      barrier: '0/100',
      flushed: '0/200',
      confirmed: { hash: 'MOCK_BLOCK', parent: 99n, previous: 'MOCK_PARENT' },
      finalized: { hash: 'MOCK_BLOCK', parent: 99n, previous: 'MOCK_PARENT' },
      root: 101n,
      finalityMs: C + 10000,
    };
    const body = {
      round: id,
      cutoffMs: C,
      model: policy.model,
      policyHash: policy.policyHash,
      clockBasis: 'MOCK_QUALIFIED_ONLY',
      sealedMs: C + 200,
      reviewReasons: [],
      members: [{ id: capture.id, digest: bytesHash(raw) }],
      selected: [{ market, id: capture.id, digest: bytesHash(raw) }],
    };
    const sealed = canonical(body);
    hours.set(id, {
      id,
      startMs: at,
      model: policy.model,
      policyHash: policy.policyHash,
      state: 'FINALIZED',
      markets: [market],
      seal: { raw: sealed, digest: bytesHash(sealed), durability: 'MOCK_COMMITTED_WAL_READ' },
      captures: [capture],
      accounts: [account],
    });
  }
  const list = [...hours.values()],
    sourceId = kind === 'DAILY' ? dayId(start) : hourId(start);
  const links = list.flatMap((h) =>
    h.accounts.map((a) => ({
      hourId: h.id,
      resultId: a.result.id,
      userId: a.userId,
      pnl: a.result.pnl,
    })),
  );
  const daily: Daily = {
    id: dayId(start),
    links,
    results: [
      { userId: 'MOCK_USER', pnl: links.reduce((n, l) => n + l.pnl, 0n), count: links.length },
    ],
  };
  const plan: Plan = {
    id: 'MOCK_PLAN_' + kind,
    kind,
    sourceId,
    startMs: start,
    snapshot: {
      version: 'MOCK_PAYOUT_SNAPSHOT',
      planId: 'MOCK_PLAN_' + kind,
      sourceId,
      resultCommitment: hash(
        list.flatMap((h) =>
          h.accounts.map((a) => ({
            hourId: h.id,
            userId: a.userId,
            resultId: a.result.id,
            pnl: a.result.pnl,
          })),
        ),
      ),
    },
  };
  const proof: Proof = {
    version: 'MOCK_SETTLEMENT_CONTRACT_V1',
    planId: plan.id,
    snapshotHash: hash(plan.snapshot),
    kind,
    sourceId,
    hours: list.map((h) => ({
      id: h.id,
      sealHash: h.seal.digest,
      financialHash: hash(financial(h)),
    })),
    dailyHash: kind === 'DAILY' ? hash(daily) : null,
  };
  const blobs = new Map<string, string>();
  const expected = new Map(
    list.map((h) => [
      h.id,
      { inputDigest: hash(replayInput(h)), financialDigest: hash(financial(h)) },
    ]),
  );
  const state = {
    now,
    holds: {
      revision: 'MOCK_HEALTH_EPOCH_1',
      observedMs: now,
      clockHealthy: true,
      hours: [],
      days: [],
    } as Holds,
  };
  const ports: Ports = {
    scope: SCOPE,
    signingDisabled: true,
    policies: [policy],
    now: () => state.now,
    loadPlan: async (id) => (id === plan.id ? structuredClone(plan) : null),
    loadProof: async (id) => blobs.get(id) ?? null,
    loadHour: async (id) => structuredClone(hours.get(id) ?? null),
    loadDaily: async (id) => (id === daily.id ? structuredClone(daily) : null),
    holds: async () => structuredClone(state.holds),
    replay: async (h) => structuredClone(expected.get(h.id)!),
  };
  const request = { planId: plan.id, snapshotHash: hash(plan.snapshot), proofHash: '' };
  const save = () => {
    const raw = canonical(proof);
    request.proofHash = bytesHash(raw);
    blobs.set(request.proofHash, raw);
  };
  save();
  const reseal = (h: Hour, edit: (s: Record<string, unknown>) => void) => {
    const body = JSON.parse(h.seal.raw) as Record<string, unknown>;
    edit(body);
    h.seal.raw = canonical(body);
    h.seal.digest = bytesHash(h.seal.raw);
    proof.hours.find((x) => x.id === h.id)!.sealHash = h.seal.digest;
    save();
  };
  return {
    ports,
    request,
    hours,
    plan,
    proof,
    daily,
    policy,
    state,
    blobs,
    save,
    reseal,
    first: () => [...hours.values()][0]!,
  };
}
