import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCreatorFeeRoute } from './creator-fee-route-readiness.mjs';

const source = () => ({
  expectedMint: 'EXPECTED_MINT', actualMint: 'EXPECTED_MINT',
  expectedCreator: 'EXPECTED_CREATOR', actualCreator: 'EXPECTED_CREATOR',
  mainnetFinalized: true, independentSourcesAgree: true,
  quoteAsset: 'SOL', feeDestination: 'direct_creator',
  bondingCurve: { exists: true, complete: false, creator: 'EXPECTED_CREATOR' },
  canonicalPool: { exists: false },
});

test('ungraduated direct-creator route is review-only', () => {
  const r = assessCreatorFeeRoute(source());
  assert.equal(r.route, 'PUMP_BONDING_CURVE');
  assert.equal(r.status, 'ROUTE_IDENTIFIED_REVIEW_ONLY');
  assert.equal(r.automaticSigningAuthorized, false);
});

test('graduated canonical SOL pool identifies both fee vaults, without authorization', () => {
  const s = source();
  s.bondingCurve.complete = true;
  s.canonicalPool = { exists: true, canonical: true, coinCreator: 'EXPECTED_CREATOR', quoteAsset: 'SOL' };
  const r = assessCreatorFeeRoute(s);
  assert.equal(r.route, 'PUMP_SWAP_CANONICAL');
  assert.deepEqual(r.requiredClaimCoverage, ['PUMP_CREATOR_VAULT', 'PUMPSWAP_CREATOR_VAULT_WSOL']);
  assert.equal(r.automaticSigningAuthorized, false);
});

test('graduation without verified pool is blocked', () => {
  const s = source();
  s.bondingCurve.complete = true;
  assert.equal(assessCreatorFeeRoute(s).reason, 'GRADUATED_CANONICAL_POOL_NOT_VERIFIED');
});

test('mismatched mint, creator, RPC corroboration and finality are blocked', () => {
  for (const diff of [
    { actualMint: 'WRONG' }, { actualCreator: 'WRONG' },
    { mainnetFinalized: false }, { independentSourcesAgree: false },
  ]) assert.equal(assessCreatorFeeRoute({ ...source(), ...diff }).status, 'HOLD');
});

test('sharing and holder rewards are not direct creator revenue', () => {
  assert.equal(assessCreatorFeeRoute({ ...source(), feeDestination: 'sharing_config' }).reason, 'SHARED_FEES_SEPARATE_POLICY_REQUIRED');
  assert.equal(assessCreatorFeeRoute({ ...source(), feeDestination: 'holder_rewards' }).reason, 'CREATOR_REVENUE_NOT_OWNED');
});

test('unsupported quote assets fail closed', () => {
  assert.equal(assessCreatorFeeRoute({ ...source(), quoteAsset: 'USDC' }).reason, 'QUOTE_ASSET_NOT_APPROVED');
});

test('conflicting curve and pool states fail closed', () => {
  assert.equal(assessCreatorFeeRoute({ ...source(), canonicalPool: { exists: true } }).reason, 'CURVE_AND_POOL_STATE_CONFLICT');
});

test('unknown evidence never authorizes signing', () => {
  for (const s of [undefined, {}, { ...source(), feeDestination: 'unknown' }]) {
    const r = assessCreatorFeeRoute(s);
    assert.equal(r.status, 'HOLD');
    assert.equal(r.automaticSigningAuthorized, false);
  }
});
