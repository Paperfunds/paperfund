import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { fixture } from './fixtures.js';
import { bytesHash, canonical, financial, hash, validateSettlement } from './contract.js';
const valid = 'MOCK_VALIDATED_NOT_FINANCIAL_AUTHORITY';
async function held(f: ReturnType<typeof fixture>, reason?: string) {
  const before = canonical({ hours: [...f.hours], daily: f.daily, plan: f.plan });
  const r = await validateSettlement(f.ports, f.request);
  expect(r.status).toBe('REVIEW');
  if (reason && r.status === 'REVIEW') expect(r.reason).toBe(reason);
  expect(canonical({ hours: [...f.hours], daily: f.daily, plan: f.plan })).toBe(before);
  return r;
}
it('canonical content hash has an independent byte-level golden and no unsafe Number conversion', () => {
  const bytes = '{"a":"9007199254740993","b":2}';
  expect(canonical({ b: 2, a: 9007199254740993n })).toBe(bytes);
  expect(hash({ b: 2, a: 9007199254740993n })).toBe(
    createHash('sha256').update(bytes).digest('hex'),
  );
  expect(() => canonical({ amount: 9007199254740992 })).toThrow('NON_CANONICAL_VALUE');
});
it.each(['HOURLY', 'DAILY'] as const)(
  'valid %s independently loaded proof returns mock-only verdict',
  async (kind) => {
    const f = fixture(kind);
    const r = await validateSettlement(f.ports, f.request);
    expect(r).toMatchObject({
      status: valid,
      planId: f.plan.id,
      snapshotHash: f.request.snapshotHash,
      signingDisabled: true,
      scope: 'STRICT_MOCK_ONLY',
    });
    expect(r).not.toHaveProperty('settlementState');
    expect(f.proof.hours).toHaveLength(kind === 'DAILY' ? 24 : 1);
  },
);
it('proof hash remains stable across fresh observer times and exact repeated validation', async () => {
  const f = fixture();
  const a = await validateSettlement(f.ports, f.request);
  f.state.now += 100;
  f.state.holds.observedMs += 100;
  const b = await validateSettlement(f.ports, f.request);
  expect(a.status).toBe(valid);
  expect(b.status).toBe(valid);
  if (a.status === valid && b.status === valid) {
    expect(a.settlementEvidenceHash).toBe(b.settlementEvidenceHash);
    expect(a.observedMs).not.toBe(b.observedMs);
  }
});
it('cannot run outside the explicitly disabled mock boundary', async () => {
  const f = fixture();
  Object.assign(f.ports, { scope: 'REAL' });
  await held(f, 'MOCK_SCOPE_REQUIRED');
});
it('signing enabled is rejected without invoking signer or send traps', async () => {
  const f = fixture();
  const sign = vi.fn(() => {
      throw Error('SIGNING_FORBIDDEN');
    }),
    send = vi.fn(() => {
      throw Error('SEND_FORBIDDEN');
    });
  Object.assign(f.ports, { sign, send, signingDisabled: false });
  await held(f, 'MOCK_SCOPE_REQUIRED');
  expect(sign).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it('exact plan ID cannot be replaced', async () => {
  const f = fixture();
  f.request.planId = 'OTHER';
  await held(f, 'PLAN_NOT_FOUND');
});
it('exact independent snapshot hash is mandatory', async () => {
  const f = fixture();
  f.request.snapshotHash = 'a'.repeat(64);
  await held(f, 'PLAN_SNAPSHOT_MISMATCH');
});
it('self-consistent rehashed proof for another plan is rejected', async () => {
  const f = fixture();
  f.proof.planId = 'OTHER';
  f.save();
  await held(f, 'PROOF_PLAN_BINDING');
});
it('changed approved snapshot cannot retain its former binding', async () => {
  const f = fixture();
  f.plan.snapshot.extra = 'changed';
  await held(f, 'PLAN_SNAPSHOT_MISMATCH');
});
it('missing content-addressed original proof is REVIEW', async () => {
  const f = fixture();
  f.blobs.clear();
  await held(f, 'PROOF_CONTENT_MISMATCH');
});
it('a digest-shaped claim does not authenticate changed proof bytes', async () => {
  const f = fixture();
  f.blobs.set(f.request.proofHash, '{"status":"FINALIZED"}');
  await held(f, 'PROOF_CONTENT_MISMATCH');
});
it('noncanonical duplicate-key proof encoding is not accepted', async () => {
  const f = fixture();
  const raw = canonical(f.proof).replace('{', '{"version":"WRONG",');
  f.request.proofHash = bytesHash(raw);
  f.blobs.set(f.request.proofHash, raw);
  await held(f, 'PROOF_NOT_CANONICAL');
});
it('a FINALIZED flag without immutable records is insufficient', async () => {
  const f = fixture();
  Object.assign(f.first(), { seal: null });
  await held(f);
});
it('unapproved model/policy fails even when state says FINALIZED', async () => {
  const f = fixture();
  f.first().policyHash = 'b'.repeat(64);
  await held(f, 'MODEL_POLICY_NOT_APPROVED');
});
it('absence of an explicit mock approval registry fails closed', async () => {
  const f = fixture();
  Object.assign(f.ports, { policies: [] });
  await held(f, 'APPROVED_MOCK_POLICY_REQUIRED');
});
it('SQL seal bytes cannot change behind an unchanged digest', async () => {
  const f = fixture();
  f.first().seal.raw += ' ';
  await held(f, 'SEAL_CONTENT_MISMATCH');
});
it('retained financial-policy REVIEW cannot be blessed by a FINALIZED flag', async () => {
  const f = fixture();
  f.reseal(f.first(), (s) => {
    s.reviewReasons = ['FINANCIAL_POLICY_UNAPPROVED'];
  });
  await held(f, 'SEALED_REVIEW');
});
it('actual unqualified clock basis is rejected rather than relabelled', async () => {
  const f = fixture();
  f.reseal(f.first(), (s) => {
    s.clockBasis = 'UNQUALIFIED_DB_CLOCK_DIAGNOSTIC';
  });
  await held(f, 'SEAL_POLICY_OR_CLOCK');
});
it('incomplete selected market coverage rejects', async () => {
  const f = fixture();
  f.reseal(f.first(), (s) => {
    s.selected = [];
  });
  await held(f, 'SELECTED_CAPTURE_MEMBERSHIP');
});
it('original captured bytes are bound to sealed member and selection', async () => {
  const f = fixture();
  f.first().captures[0]!.raw += ' ';
  await held(f, 'CAPTURE_DIGEST_BINDING');
});
it('flush LSN behind the protected barrier rejects', async () => {
  const f = fixture();
  f.first().captures[0]!.flushed = '0/FF';
  await held(f, 'CAPTURE_DURABILITY');
});
it('late certification cannot be backdated with source time', async () => {
  const f = fixture();
  f.first().captures[0]!.certifiedMs = f.first().startMs + 3600000;
  await held(f, 'CAPTURE_DURABILITY');
});
it('freshness boundary allows reported 4000 ms with explicit mock reserve', async () => {
  const f = fixture('HOURLY', 4000);
  expect((await validateSettlement(f.ports, f.request)).status).toBe(valid);
});
it('reported 4001 ms is rejected without widening policy', async () => {
  const f = fixture('HOURLY', 4001);
  await held(f, 'CUTOFF_FRESHNESS');
});
it('fee and FX evidence cannot be stale while token price is fresh', async () => {
  const f = fixture();
  f.first().captures[0]!.fxMs -= 4000;
  await held(f, 'CUTOFF_FRESHNESS');
});
it('finalized root behind original source slot rejects', async () => {
  const f = fixture();
  f.first().captures[0]!.root = 99n;
  await held(f, 'FINALITY_UNAVAILABLE_OR_CONFLICT');
});
it('contradictory exact-slot block metadata rejects', async () => {
  const f = fixture();
  f.first().captures[0]!.finalized.hash = 'OTHER';
  await held(f, 'FINALITY_UNAVAILABLE_OR_CONFLICT');
});
it('finality observed after the fixed deadline cannot repair proof', async () => {
  const f = fixture();
  f.first().captures[0]!.finalityMs = f.first().startMs + 3600000 + 60001;
  await held(f, 'FINALITY_UNAVAILABLE_OR_CONFLICT');
});

it('ledger journals must balance independently of FINALIZED/results flags', async () => {
  const f = fixture();
  f.first().accounts[0]!.journals[1]!.lines[0]!.amount += 1n;
  await held(f, 'UNBALANCED_JOURNAL');
});
it('result cash and PnL must reconcile to exact integer journals', async () => {
  const f = fixture();
  f.first().accounts[0]!.result.cash += 1n;
  await held(f, 'RESULT_LEDGER_MISMATCH');
});
it('remaining position or basis prevents accepted settlement', async () => {
  const f = fixture();
  f.first().accounts[0]!.quantity = 1n;
  await held(f, 'OPEN_POSITION_OR_BASIS');
});
it('balanced fabricated profit and rehashed financial proof fail independent replay', async () => {
  const f = fixture();
  const h = f.first(),
    a = h.accounts[0]!;
  a.journals.push({
    id: 'forged',
    lines: [
      { account: 'CASH', side: 'DEBIT', amount: 1n },
      { account: 'TRADING_PNL', side: 'CREDIT', amount: 1n },
    ],
  });
  a.result.cash += 1n;
  a.result.pnl += 1n;
  f.proof.hours[0]!.financialHash = hash(financial(h));
  f.save();
  await held(f, 'INDEPENDENT_REPLAY_MISMATCH');
});
it('unavailable original replay cannot be replaced by a result status', async () => {
  const f = fixture();
  f.ports.replay = async () => {
    throw Error('ORIGINAL_REPLAY_UNAVAILABLE');
  };
  await held(f, 'ORIGINAL_REPLAY_UNAVAILABLE');
});
it('daily proof must cover all 24 exact UTC dependency hours', async () => {
  const f = fixture('DAILY');
  f.proof.hours.pop();
  f.save();
  await held(f, 'DEPENDENCY_SET_MISMATCH');
});
it('duplicate daily hour cannot replace a missing dependency', async () => {
  const f = fixture('DAILY');
  f.proof.hours[23] = f.proof.hours[0]!;
  f.save();
  await held(f, 'DEPENDENCY_SET_MISMATCH');
});
it('unavailable historical hour remains REVIEW', async () => {
  const f = fixture('DAILY');
  f.hours.delete(f.proof.hours[12]!.id);
  await held(f, 'HOUR_MISSING');
});
it('daily contribution omission cannot be hidden by rehashing the daily summary', async () => {
  const f = fixture('DAILY');
  f.daily.links.pop();
  f.proof.dailyHash = hash(f.daily);
  f.save();
  await held(f, 'DAILY_LINKS_MISMATCH');
});
it('daily aggregate cannot omit a negative hourly loss', async () => {
  const f = fixture('DAILY');
  f.daily.results[0]!.pnl += 40000000n;
  f.proof.dailyHash = hash(f.daily);
  f.save();
  await held(f, 'DAILY_PNL_MISMATCH');
});
it('hourly REVIEW dependency blocks a daily plan even if later hours finalized', async () => {
  const f = fixture('DAILY');
  f.state.holds.hours = [f.proof.hours[0]!.id];
  await held(f, 'REVIEW_DEPENDENCY');
});
it('affected UTC-day hold blocks an hourly plan', async () => {
  const f = fixture();
  f.state.holds.days = [f.daily.id];
  await held(f, 'REVIEW_DEPENDENCY');
});
it('unrelated hourly REVIEW does not silently change this contract dependency scope', async () => {
  const f = fixture();
  f.state.holds.hours = ['hourly:2044-01-01T00:00:00.000Z'];
  expect((await validateSettlement(f.ports, f.request)).status).toBe(valid);
});
it('stale live hold-health evidence cannot authorize a fresh check', async () => {
  const f = fixture();
  f.state.holds.observedMs -= 30001;
  await held(f, 'HOLD_HEALTH_UNAVAILABLE');
});
it('future live hold-health evidence is rejected', async () => {
  const f = fixture();
  f.state.holds.observedMs += 1;
  await held(f, 'HOLD_HEALTH_UNAVAILABLE');
});
it('global clock-health failure blocks validation', async () => {
  const f = fixture();
  f.state.holds.clockHealthy = false;
  await held(f, 'CLOCK_UNQUALIFIED');
});
it('a REVIEW introduced during asynchronous replay is rechecked', async () => {
  const f = fixture();
  const replay = f.ports.replay;
  f.ports.replay = async (h) => {
    const r = await replay(h);
    f.state.holds.hours = [h.id];
    return r;
  };
  await held(f, 'REVIEW_DEPENDENCY');
});
it('a changed hold revision forces a fresh check even without a visible hold', async () => {
  const f = fixture();
  const replay = f.ports.replay;
  f.ports.replay = async (h) => {
    const r = await replay(h);
    f.state.holds.revision = 'MOCK_NEW_EPOCH';
    return r;
  };
  await held(f, 'HOLD_REVISION_CHANGED');
});
it('repository transport failure returns REVIEW without financial mutation', async () => {
  const f = fixture();
  f.ports.loadHour = async () => {
    throw Error('MOCK_STORAGE_UNAVAILABLE');
  };
  await held(f, 'MOCK_STORAGE_UNAVAILABLE');
});
it('trusted snapshot result commitment must match every actual result', async () => {
  const f = fixture();
  f.plan.snapshot.resultCommitment = 'c'.repeat(64);
  f.request.snapshotHash = hash(f.plan.snapshot);
  f.proof.snapshotHash = f.request.snapshotHash;
  f.save();
  await held(f, 'SNAPSHOT_RESULT_BINDING');
});
it('valid and rejected paths never call synthetic signer or send hooks', async () => {
  const f = fixture();
  const sign = vi.fn(() => {
      throw Error('FORBIDDEN');
    }),
    send = vi.fn(() => {
      throw Error('FORBIDDEN');
    });
  Object.assign(f.ports, { sign, send });
  expect((await validateSettlement(f.ports, f.request)).status).toBe(valid);
  f.state.holds.hours = [f.first().id];
  await held(f, 'REVIEW_DEPENDENCY');
  expect(sign).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it('an immutable seal may retain unselected eligible members without changing selected execution', async () => {
  const f = fixture();
  f.reseal(f.first(), (s) => {
    (s.members as unknown[]).push({ id: 'MOCK_RETAINED_UNSELECTED', digest: 'd'.repeat(64) });
  });
  expect((await validateSettlement(f.ports, f.request)).status).toBe(valid);
});
it('duplicate member identities cannot hide conflicting sealed capture references', async () => {
  const f = fixture();
  f.reseal(f.first(), (s) => {
    const members = s.members as unknown[];
    members.push(members[0]);
  });
  await held(f, 'CAPTURE_MEMBERSHIP');
});
it('selected evidence cannot omit an immutable member reference', async () => {
  const f = fixture();
  f.reseal(f.first(), (s) => {
    s.members = [];
  });
  await held(f, 'CAPTURE_DIGEST_BINDING');
});
it('a future seal cannot become a past durability statement', async () => {
  const f = fixture();
  f.reseal(f.first(), (s) => {
    s.sealedMs = f.state.now + 1;
  });
  await held(f, 'SEAL_POLICY_OR_CLOCK');
});
it('future finality inside the nominal deadline is not yet available evidence', async () => {
  const f = fixture();
  const C = f.first().startMs + 3600000;
  f.state.now = C + 5000;
  f.state.holds.observedMs = f.state.now;
  await held(f, 'FINALITY_UNAVAILABLE_OR_CONFLICT');
});
it('the exact finality deadline remains inclusive with already observed original evidence', async () => {
  const f = fixture();
  f.first().captures[0]!.finalityMs = f.first().startMs + 3600000 + 60000;
  expect((await validateSettlement(f.ports, f.request)).status).toBe(valid);
});
