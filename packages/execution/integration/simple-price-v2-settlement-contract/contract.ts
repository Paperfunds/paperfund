import { createHash } from 'node:crypto';
export const SIGNING_DISABLED = true;
export const SCOPE = 'STRICT_MOCK_ONLY' as const;
export function canonical(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(normalize);
    if (v !== null && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, normalize(x)]),
      );
    if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isSafeInteger(v))
    )
      return v;
    throw Error('NON_CANONICAL_VALUE');
  };
  return JSON.stringify(normalize(value));
}
export const bytesHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export const hash = (v: unknown) => bytesHash(canonical(v));
export interface MockPolicy {
  approval: 'MOCK_APPROVAL_NOT_OPERATOR_AUTHORIZATION';
  model: string;
  policyHash: string;
  maxAgeMs: number;
  reserveMs: number;
  totalAgeMs: number;
  epsilonMs: number;
  finalityWaitMs: number;
  healthAgeMs: number;
}
export interface Plan {
  id: string;
  kind: 'HOURLY' | 'DAILY';
  sourceId: string;
  startMs: number;
  snapshot: { resultCommitment: string; [key: string]: unknown };
}
export interface Proof {
  version: 'MOCK_SETTLEMENT_CONTRACT_V1';
  planId: string;
  snapshotHash: string;
  kind: Plan['kind'];
  sourceId: string;
  hours: { id: string; sealHash: string; financialHash: string }[];
  dailyHash: string | null;
}
export interface Line {
  account: 'CASH' | 'POSITION_COST' | 'HOURLY_STARTING_CAPITAL' | 'TRADING_PNL' | 'TRADING_FEES';
  side: 'DEBIT' | 'CREDIT';
  amount: bigint;
}
export interface Account {
  id: string;
  userId: string;
  starting: bigint;
  quantity: bigint;
  basis: bigint;
  journals: { id: string; lines: Line[] }[];
  result: { id: string; cash: bigint; pnl: bigint };
}
export interface Capture {
  id: string;
  market: string;
  raw: string;
  sourceMs: number;
  slot: bigint;
  feeMs: number;
  fxMs: number;
  quoteMs: number;
  certifiedMs: number;
  barrier: string;
  flushed: string;
  confirmed: { hash: string; parent: bigint; previous: string };
  finalized: { hash: string; parent: bigint; previous: string };
  root: bigint;
  finalityMs: number;
}
export interface Hour {
  id: string;
  startMs: number;
  model: string;
  policyHash: string;
  state: string;
  markets: string[];
  seal: { raw: string; digest: string; durability: 'MOCK_COMMITTED_WAL_READ' };
  captures: Capture[];
  accounts: Account[];
}
export interface Daily {
  id: string;
  links: { hourId: string; resultId: string; userId: string; pnl: bigint }[];
  results: { userId: string; pnl: bigint; count: number }[];
}
export interface Holds {
  revision: string;
  observedMs: number;
  clockHealthy: boolean;
  hours: string[];
  days: string[];
}
export interface Ports {
  scope: typeof SCOPE;
  signingDisabled: true;
  policies: readonly MockPolicy[];
  now(): number;
  loadPlan(id: string): Promise<Plan | null>;
  loadProof(digest: string): Promise<string | null>;
  loadHour(id: string): Promise<Hour | null>;
  loadDaily(id: string): Promise<Daily | null>;
  holds(): Promise<Holds>;
  replay(hour: Hour): Promise<{ inputDigest: string; financialDigest: string }>;
}
export const hourId = (ms: number) => 'hourly:' + new Date(ms).toISOString();
export const dayId = (ms: number) => 'daily:' + new Date(ms).toISOString().slice(0, 10);
export const financial = (h: Hour) => ({ id: h.id, accounts: h.accounts });
export const replayInput = (h: Hour) => ({
  id: h.id,
  model: h.model,
  policyHash: h.policyHash,
  rawCaptures: h.captures.map((c) => ({ id: c.id, raw: c.raw })),
});
function requireThat(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Error(reason);
}
function exact(a: string[], b: string[], why: string) {
  requireThat(
    a.length === new Set(a).size &&
      b.length === new Set(b).size &&
      canonical([...a].sort()) === canonical([...b].sort()),
    why,
  );
}
function lsn(s: string) {
  requireThat(/^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/i.test(s), 'INVALID_LSN');
  const [a, b] = s.split('/');
  return (BigInt('0x' + a) << 32n) + BigInt('0x' + b);
}
function balances(a: Account) {
  requireThat(a.starting > 0n && a.quantity === 0n && a.basis === 0n, 'OPEN_POSITION_OR_BASIS');
  requireThat(
    a.journals.length > 0 && new Set(a.journals.map((j) => j.id)).size === a.journals.length,
    'JOURNAL_IDENTITY',
  );
  const totals = {
    CASH: 0n,
    POSITION_COST: 0n,
    HOURLY_STARTING_CAPITAL: 0n,
    TRADING_PNL: 0n,
    TRADING_FEES: 0n,
  };
  for (const j of a.journals) {
    let d = 0n,
      c = 0n;
    requireThat(j.lines.length >= 2, 'JOURNAL_INCOMPLETE');
    for (const l of j.lines) {
      requireThat(
        typeof l.amount === 'bigint' &&
          l.amount > 0n &&
          l.account in totals &&
          (l.side === 'DEBIT' || l.side === 'CREDIT'),
        'INVALID_LEDGER_LINE',
      );
      if (l.side === 'DEBIT') d += l.amount;
      else c += l.amount;
      totals[l.account] += l.side === 'DEBIT' ? l.amount : -l.amount;
    }
    requireThat(d === c, 'UNBALANCED_JOURNAL');
  }
  requireThat(
    totals.CASH >= 0n &&
      totals.POSITION_COST === 0n &&
      -totals.HOURLY_STARTING_CAPITAL === a.starting,
    'LEDGER_CAPITAL_OR_BASIS',
  );
  requireThat(
    totals.CASH === a.result.cash && a.result.pnl === a.result.cash - a.starting,
    'RESULT_LEDGER_MISMATCH',
  );
  requireThat(
    totals.CASH === a.starting - totals.TRADING_PNL - totals.TRADING_FEES,
    'LEDGER_RECONCILIATION',
  );
}

export async function validateSettlement(
  ports: Ports,
  request: { planId: string; snapshotHash: string; proofHash: string },
) {
  try {
    requireThat(ports.scope === SCOPE && ports.signingDisabled === true, 'MOCK_SCOPE_REQUIRED');
    const plan = await ports.loadPlan(request.planId);
    requireThat(plan && plan.id === request.planId, 'PLAN_NOT_FOUND');
    requireThat(hash(plan.snapshot) === request.snapshotHash, 'PLAN_SNAPSHOT_MISMATCH');
    requireThat(
      Number.isSafeInteger(plan.startMs) && plan.startMs % 3600000 === 0,
      'CANONICAL_TIME_REQUIRED',
    );
    const ids =
      plan.kind === 'HOURLY'
        ? [hourId(plan.startMs)]
        : Array.from({ length: 24 }, (_, i) => hourId(plan.startMs + i * 3600000));
    requireThat(
      plan.kind === 'HOURLY' || (plan.kind === 'DAILY' && plan.startMs % 86400000 === 0),
      'PLAN_KIND_OR_DAY',
    );
    requireThat(
      plan.sourceId === (plan.kind === 'HOURLY' ? ids[0] : dayId(plan.startMs)),
      'PLAN_SOURCE_MISMATCH',
    );
    const first = await ports.holds();
    const checkHolds = (h: Holds, maxAge: number) => {
      const now = ports.now();
      requireThat(
        Number.isSafeInteger(now) &&
          Number.isSafeInteger(h.observedMs) &&
          h.observedMs <= now &&
          now - h.observedMs <= maxAge &&
          h.revision.length > 0,
        'HOLD_HEALTH_UNAVAILABLE',
      );
      requireThat(h.clockHealthy, 'CLOCK_UNQUALIFIED');
      requireThat(
        !h.hours.some((id) => ids.includes(id)) && !h.days.includes(dayId(plan.startMs)),
        'REVIEW_DEPENDENCY',
      );
    };
    requireThat(ports.policies.length > 0, 'APPROVED_MOCK_POLICY_REQUIRED');
    const healthAge = Math.min(...ports.policies.map((p) => p.healthAgeMs));
    checkHolds(first, healthAge);
    const raw = await ports.loadProof(request.proofHash);
    requireThat(raw && bytesHash(raw) === request.proofHash, 'PROOF_CONTENT_MISMATCH');
    const proof = JSON.parse(raw) as Proof;
    requireThat(canonical(proof) === raw, 'PROOF_NOT_CANONICAL');
    requireThat(
      proof.version === 'MOCK_SETTLEMENT_CONTRACT_V1' &&
        proof.planId === plan.id &&
        proof.snapshotHash === request.snapshotHash &&
        proof.kind === plan.kind &&
        proof.sourceId === plan.sourceId,
      'PROOF_PLAN_BINDING',
    );
    exact(
      proof.hours.map((h) => h.id),
      ids,
      'DEPENDENCY_SET_MISMATCH',
    );
    const all: Hour[] = [];
    for (const id of ids) {
      const h = await ports.loadHour(id);
      requireThat(h && h.id === id && hourId(h.startMs) === id, 'HOUR_MISSING');
      const p = ports.policies.find((p) => p.model === h.model && p.policyHash === h.policyHash);
      requireThat(
        p?.approval === 'MOCK_APPROVAL_NOT_OPERATOR_AUTHORIZATION' &&
          p.model.startsWith('MOCK_') &&
          p.policyHash.length === 64,
        'MODEL_POLICY_NOT_APPROVED',
      );
      requireThat(
        [p.maxAgeMs, p.reserveMs, p.totalAgeMs, p.epsilonMs, p.finalityWaitMs, p.healthAgeMs].every(
          (x) => Number.isSafeInteger(x) && x > 0,
        ) && p.maxAgeMs + p.reserveMs <= p.totalAgeMs,
        'INVALID_MOCK_POLICY',
      );
      const cutoff = h.startMs + 3600000,
        ref = proof.hours.find((x) => x.id === id)!;
      requireThat(
        h.seal.durability === 'MOCK_COMMITTED_WAL_READ' &&
          bytesHash(h.seal.raw) === h.seal.digest &&
          h.seal.digest === ref.sealHash,
        'SEAL_CONTENT_MISMATCH',
      );
      const seal = JSON.parse(h.seal.raw) as {
        round: string;
        cutoffMs: number;
        model: string;
        policyHash: string;
        clockBasis: string;
        sealedMs: number;
        reviewReasons: string[];
        members: { id: string; digest: string }[];
        selected: { market: string; id: string; digest: string }[];
      };
      requireThat(
        seal.round === id &&
          seal.cutoffMs === cutoff &&
          seal.model === h.model &&
          seal.policyHash === h.policyHash &&
          seal.clockBasis === 'MOCK_QUALIFIED_ONLY' &&
          Number.isSafeInteger(seal.sealedMs) &&
          seal.sealedMs <= ports.now() &&
          seal.sealedMs - p.epsilonMs >= cutoff,
        'SEAL_POLICY_OR_CLOCK',
      );
      requireThat(
        Array.isArray(seal.reviewReasons) && seal.reviewReasons.length === 0,
        'SEALED_REVIEW',
      );
      exact(
        seal.members.map((c) => c.id),
        seal.members.map((c) => c.id),
        'CAPTURE_MEMBERSHIP',
      );
      exact(
        seal.selected.map((c) => c.id),
        h.captures.map((c) => c.id),
        'SELECTED_CAPTURE_MEMBERSHIP',
      );
      exact(
        h.captures.map((c) => c.market),
        h.markets,
        'CAPTURE_MARKET_COVERAGE',
      );
      exact(
        seal.selected.map((c) => c.market),
        h.markets,
        'MARKET_COVERAGE',
      );
      for (const c of h.captures) {
        const digest = bytesHash(c.raw),
          member = seal.members.find((m) => m.id === c.id),
          selected = seal.selected.find((s) => s.id === c.id && s.market === c.market);
        requireThat(
          member?.digest === digest && selected?.digest === digest,
          'CAPTURE_DIGEST_BINDING',
        );
        requireThat(
          Number.isSafeInteger(c.certifiedMs) &&
            c.certifiedMs + p.epsilonMs < cutoff &&
            lsn(c.barrier) > 0n &&
            lsn(c.flushed) >= lsn(c.barrier),
          'CAPTURE_DURABILITY',
        );
        requireThat(
          [c.sourceMs, c.fxMs, c.feeMs, c.quoteMs].every(
            (s) =>
              Number.isSafeInteger(s) &&
              s <= c.certifiedMs &&
              s <= cutoff &&
              cutoff - s <= p.maxAgeMs &&
              cutoff - s + p.reserveMs <= p.totalAgeMs,
          ),
          'CUTOFF_FRESHNESS',
        );
        const original = JSON.parse(c.raw) as {
          market: string;
          slot: string;
          sourceMs: number;
          fxMs: number;
          feeMs: number;
          quoteMs: number;
        };
        requireThat(
          original.market === c.market &&
            original.slot === c.slot.toString() &&
            original.sourceMs === c.sourceMs &&
            original.fxMs === c.fxMs &&
            original.feeMs === c.feeMs &&
            original.quoteMs === c.quoteMs,
          'CAPTURE_PROVENANCE',
        );
        requireThat(
          c.slot > 0n &&
            c.root >= c.slot &&
            c.confirmed.hash.length > 0 &&
            c.confirmed.previous.length > 0 &&
            c.confirmed.parent >= 0n &&
            c.confirmed.parent < c.slot &&
            canonical(c.confirmed) === canonical(c.finalized) &&
            Number.isSafeInteger(c.finalityMs) &&
            c.finalityMs >= c.certifiedMs &&
            c.finalityMs <= cutoff + p.finalityWaitMs &&
            c.finalityMs <= ports.now(),
          'FINALITY_UNAVAILABLE_OR_CONFLICT',
        );
      }
      requireThat(h.state === 'FINALIZED', 'RESULT_NOT_FINAL');
      exact(
        h.accounts.map((a) => a.id),
        h.accounts.map((a) => a.id),
        'ACCOUNT_IDENTITY',
      );
      exact(
        h.accounts.map((a) => a.userId),
        h.accounts.map((a) => a.userId),
        'USER_IDENTITY',
      );
      exact(
        h.accounts.map((a) => a.result.id),
        h.accounts.map((a) => a.result.id),
        'RESULT_IDENTITY',
      );
      for (const a of h.accounts) balances(a);
      requireThat(hash(financial(h)) === ref.financialHash, 'FINANCIAL_PROOF_BINDING');
      const replay = await ports.replay(structuredClone(h));
      requireThat(
        replay.inputDigest === hash(replayInput(h)) &&
          replay.financialDigest === hash(financial(h)),
        'INDEPENDENT_REPLAY_MISMATCH',
      );
      all.push(h);
    }
    requireThat(
      hash(
        all.flatMap((h) =>
          h.accounts.map((a) => ({
            hourId: h.id,
            userId: a.userId,
            resultId: a.result.id,
            pnl: a.result.pnl,
          })),
        ),
      ) === plan.snapshot.resultCommitment,
      'SNAPSHOT_RESULT_BINDING',
    );
    if (plan.kind === 'DAILY') {
      const d = await ports.loadDaily(plan.sourceId);
      requireThat(
        d && d.id === plan.sourceId && hash(d) === proof.dailyHash,
        'DAILY_PROOF_MISSING',
      );
      const links = all.flatMap((h) =>
        h.accounts.map((a) => ({
          hourId: h.id,
          resultId: a.result.id,
          userId: a.userId,
          pnl: a.result.pnl,
        })),
      );
      exact(
        d.links.map((l) => hash(l)),
        links.map((l) => hash(l)),
        'DAILY_LINKS_MISMATCH',
      );
      const users = [...new Set(links.map((l) => l.userId))];
      exact(
        d.results.map((r) => r.userId),
        users,
        'DAILY_USERS_MISMATCH',
      );
      for (const r of d.results) {
        const own = links.filter((l) => l.userId === r.userId);
        requireThat(
          r.count === own.length && r.pnl === own.reduce((n, l) => n + l.pnl, 0n),
          'DAILY_PNL_MISMATCH',
        );
      }
    } else requireThat(proof.dailyHash === null, 'UNEXPECTED_DAILY_PROOF');
    const last = await ports.holds();
    checkHolds(last, healthAge);
    requireThat(last.revision === first.revision, 'HOLD_REVISION_CHANGED');
    return {
      status: 'MOCK_VALIDATED_NOT_FINANCIAL_AUTHORITY' as const,
      planId: plan.id,
      snapshotHash: request.snapshotHash,
      settlementEvidenceHash: request.proofHash,
      observedMs: ports.now(),
      scope: SCOPE,
      signingDisabled: true as const,
    };
  } catch (e) {
    return {
      status: 'REVIEW' as const,
      reason: e instanceof Error ? e.message : 'EVIDENCE_UNAVAILABLE',
      scope: SCOPE,
      signingDisabled: true as const,
    };
  }
}
