/** Review copy of preserved block-metadata helpers; not account-state authorization. */
export interface Block {
  blockhash: string;
  previousBlockhash: string;
  parentSlot: number;
}
/** Provider-attested block consistency only, never a cryptographic inclusion proof for accounts. */
export function blockDecision(
  slot: number,
  rootSlot: number | null,
  confirmed: Block | null,
  finalized: Block | null,
) {
  if (
    !Number.isSafeInteger(slot) ||
    slot <= 0 ||
    (rootSlot !== null && (!Number.isSafeInteger(rootSlot) || rootSlot < 0))
  )
    return 'REVIEW_INVALID_FINALITY_FIELDS';
  if (
    [confirmed, finalized].some(
      (b) =>
        b &&
        (!b.blockhash ||
          !b.previousBlockhash ||
          !Number.isSafeInteger(b.parentSlot) ||
          b.parentSlot < 0 ||
          b.parentSlot >= slot),
    )
  )
    return 'REVIEW_INVALID_FINALITY_FIELDS';
  if (rootSlot === null || rootSlot < slot || !confirmed || !finalized)
    return 'REVIEW_FINALITY_UNAVAILABLE';
  if (
    confirmed.blockhash !== finalized.blockhash ||
    confirmed.previousBlockhash !== finalized.previousBlockhash ||
    confirmed.parentSlot !== finalized.parentSlot
  )
    return 'REVIEW_FORK_OR_PROVIDER_CONFLICT';
  return 'PROVIDER_ATTESTED_BLOCK_FINALIZED_ACCOUNT_INCLUSION_NOT_PROVEN';
}
export function cursorDecision(
  current: { slot: number; sourceMs: number },
  previous: { slot: number; sourceMs: number },
) {
  return current.slot < previous.slot || current.sourceMs < previous.sourceMs
    ? 'REVIEW_PROVIDER_REGRESSION'
    : 'ORDERED';
}
export function exactSlotMetadata(
  slot: number,
  confirmed: Block | null,
  refs: readonly { source: string; slot: number; finalized?: Block }[],
) {
  const same = refs.filter((r) => r.slot === slot && r.finalized);
  if (!confirmed || !same.length) return { decision: 'REVIEW_FINALITY_UNAVAILABLE', sources: [] };
  const decisions = same.map((r) => blockDecision(slot, slot, confirmed, r.finalized!));
  if (decisions.some((d) => d.startsWith('REVIEW')))
    return { decision: 'REVIEW_FORK_OR_PROVIDER_CONFLICT', sources: same.map((r) => r.source) };
  return {
    decision: 'PROVIDER_ATTESTED_EXACT_SLOT_FINALIZED_ACCOUNT_INCLUSION_NOT_PROVEN',
    sources: same.map((r) => r.source),
  };
}
