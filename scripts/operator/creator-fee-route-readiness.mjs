/**
 * Offline, read-only route classification for official-token creator fees.
 *
 * Never queries an RPC, builds or signs a transaction, changes configuration,
 * or grants permission. All inputs must originate from independently verified,
 * finalized and corroborated on-chain evidence.
 *
 * NOT wired into the protected production claim executor.
 */
export function assessCreatorFeeRoute(snapshot) {
  const hold = (reason) => ({
    status: 'HOLD',
    reason,
    route: null,
    automaticSigningAuthorized: false,
  });
  if (!snapshot || typeof snapshot !== 'object') return hold('SNAPSHOT_MISSING');
  const {
    expectedMint,
    actualMint,
    expectedCreator,
    actualCreator,
    mainnetFinalized,
    independentSourcesAgree,
    quoteAsset,
    feeDestination,
    bondingCurve,
    canonicalPool,
  } = snapshot;
  if (
    !expectedMint || !actualMint || !expectedCreator || !actualCreator ||
    actualMint !== expectedMint || actualCreator !== expectedCreator
  ) return hold('OFFICIAL_MINT_OR_CREATOR_NOT_VERIFIED');
  if (mainnetFinalized !== true || independentSourcesAgree !== true)
    return hold('FINALIZED_INDEPENDENT_EVIDENCE_REQUIRED');
  if (quoteAsset !== 'SOL') return hold('QUOTE_ASSET_NOT_APPROVED');
  if (feeDestination === 'holder_rewards') return hold('CREATOR_REVENUE_NOT_OWNED');
  if (feeDestination === 'sharing_config') return hold('SHARED_FEES_SEPARATE_POLICY_REQUIRED');
  if (feeDestination !== 'direct_creator') return hold('FEE_DESTINATION_UNKNOWN');
  if (
    !bondingCurve || bondingCurve.exists !== true ||
    bondingCurve.creator !== expectedCreator ||
    typeof bondingCurve.complete !== 'boolean'
  ) return hold('BONDING_CURVE_EVIDENCE_INVALID');
  if (bondingCurve.complete === false) {
    if (canonicalPool?.exists === true) return hold('CURVE_AND_POOL_STATE_CONFLICT');
    if (!canonicalPool || canonicalPool.exists !== false) return hold('POOL_ABSENCE_NOT_VERIFIED');
    return {
      status: 'ROUTE_IDENTIFIED_REVIEW_ONLY',
      route: 'PUMP_BONDING_CURVE',
      requiredClaimCoverage: ['PUMP_CREATOR_VAULT'],
      reason: 'PROTECTED_SIGNER_AND_FINANCIAL_ACCEPTANCE_STILL_REQUIRED',
      automaticSigningAuthorized: false,
    };
  }
  if (
    !canonicalPool || canonicalPool.exists !== true ||
    canonicalPool.canonical !== true ||
    canonicalPool.coinCreator !== expectedCreator ||
    canonicalPool.quoteAsset !== 'SOL'
  ) return hold('GRADUATED_CANONICAL_POOL_NOT_VERIFIED');
  return {
    status: 'ROUTE_IDENTIFIED_REVIEW_ONLY',
    route: 'PUMP_SWAP_CANONICAL',
    requiredClaimCoverage: ['PUMP_CREATOR_VAULT', 'PUMPSWAP_CREATOR_VAULT_WSOL'],
    reason: 'PUMPSWAP_CLAIM_ADAPTER_AND_FINANCIAL_ACCEPTANCE_REQUIRED',
    automaticSigningAuthorized: false,
  };
}
