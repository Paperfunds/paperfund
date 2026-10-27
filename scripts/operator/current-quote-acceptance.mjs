// Signed source scope for the approved current-quote model; no signing/publication here.
import { fail } from './automation-core.mjs';
export const CURRENT_QUOTE_ACCEPTANCE = 'CURRENT_NATIVE_CUTOFF_V1';
export function currentQuoteAcceptance(p) {
  if (p.executionModel === undefined) return false;
  if (
    p.executionModel !== CURRENT_QUOTE_ACCEPTANCE ||
    typeof p.settlementPolicyId !== 'string' ||
    !p.settlementPolicyId
  )
    fail('CURRENT_SOURCE_POLICY_INVALID');
  const rows = p.provider?.routeCoverage;
  if (
    p.provider?.scope !== 'ACTUALLY_USED_ROUTES_V1' ||
    !Array.isArray(p.provider.evidenceHashes) ||
    !Array.isArray(rows) ||
    rows.length !== p.hours.length ||
    new Set(rows.map((r) => r.roundId)).size !== rows.length
  )
    fail('CURRENT_SOURCE_ROUTE_COVERAGE_REQUIRED');
  for (const h of p.hours) {
    const r = rows.find((r) => r.roundId === h.roundId);
    if (
      !r ||
      !Number.isSafeInteger(r.routeCount) ||
      r.routeCount < 0 ||
      !['FLAT_AT_CUTOFF', 'PINNED_CUTOFF_EXITS'].includes(r.settlementKind) ||
      !/^[a-f0-9]{64}$/.test(r.routeEvidenceHash ?? '') ||
      !/^[a-f0-9]{64}$/.test(r.cutoffEvidenceHash ?? '') ||
      r.routeEvidenceHash !== h.routeEvidenceHash ||
      r.cutoffEvidenceHash !== h.cutoffEvidenceHash ||
      (r.settlementKind === 'PINNED_CUTOFF_EXITS' &&
        (!/^[a-f0-9]{64}$/.test(h.preCutoffCaptureHash ?? '') ||
          !p.provider.evidenceHashes.includes(h.preCutoffCaptureHash)))
    )
      fail('CURRENT_SOURCE_EVIDENCE_INVALID');
  }
  return true;
}
export async function assertCurrentQuoteSourceScope(client, p, h) {
  if (!currentQuoteAcceptance(p)) return;
  const row = (
    await client.query('select current_quote_source_scope($1,$2) proof', [
      h.roundId,
      p.settlementPolicyId,
    ])
  ).rows[0]?.proof;
  const expected = p.provider.routeCoverage.find((r) => r.roundId === h.roundId);
  if (
    !row?.qualified ||
    ['routeCount', 'routeEvidenceHash', 'cutoffEvidenceHash', 'settlementKind'].some(
      (k) => row[k] !== expected[k],
    )
  )
    fail('CURRENT_SOURCE_SCOPE_CHANGED_OR_UNQUALIFIED');
}
