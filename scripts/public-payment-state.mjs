// Fixed SELECT queries in a read-only transaction. No accounting or payout action is callable here.
import { withReadonlyDatabase } from './operator/treasury.mjs';
let cached;
let expiresAt = 0;
let pending;
export async function publicPaymentState() {
  if (cached && Date.now() < expiresAt) return cached;
  if (pending) return pending;
  pending = withReadonlyDatabase(async (client) => {
    const stop = (await client.query('select stopped from payout_stop_state where singleton=true'))
      .rows[0];
    const qualified = (
      await client.query(
        "select coalesce(sum(lamports),0)::text amount from payout_treasury_receipts where kind='CREATOR_FEE' and network='mainnet-beta'",
      )
    ).rows[0].amount;
    const reserved = (
      await client.query(
        "select (coalesce((select sum(principal) from payout_treasury_reservations where network='mainnet-beta'),0)-coalesce((select sum(s.principal) from payout_treasury_settlements s join payout_treasury_reservations r on r.plan_id=s.plan_id where r.network='mainnet-beta'),0))::text amount",
      )
    ).rows[0].amount;
    if (BigInt(reserved) < 0n) throw Error('RESERVATION_RECONCILIATION_REQUIRED');
    const payouts = (
      await client.query(
        "select s.signature,s.principal::text lamports,b.verified_at from payout_treasury_settlements s join payout_batches b on b.id=s.batch_id join payout_executions e on e.id=b.payout_execution_id where e.network='mainnet-beta' and b.state='VERIFIED' and b.verified_at is not null and b.transaction_signature=s.signature order by b.verified_at desc limit 50",
      )
    ).rows;
    return {
      paymentStateObservedAt: new Date().toISOString(),
      stop:
        stop?.stopped === true ? 'ASSERTED' : stop?.stopped === false ? 'RELEASED' : 'UNAVAILABLE',
      qualifiedLamports: qualified,
      reservedLamports: reserved,
      payoutHistory: payouts.map((row) => ({
        signature: row.signature,
        lamports: row.lamports,
        verifiedAt: row.verified_at.toISOString(),
        status: 'VERIFIED',
      })),
    };
  })
    .then((result) => {
      cached = result;
      expiresAt = Date.now() + 15000;
      return result;
    })
    .catch(() => ({
      paymentStateObservedAt: null,
      stop: 'UNAVAILABLE',
      qualifiedLamports: null,
      reservedLamports: null,
      payoutHistory: null,
    }))
    .finally(() => {
      pending = null;
    });
  return pending;
}
