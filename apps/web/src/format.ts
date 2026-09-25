export {
  formatSol,
  formatUnits,
  lamportsToSolInput,
  percentageQuantity,
  shorten,
  solTextToLamports,
  venueName,
} from '@paperfund/shared/browser';

export function pnlClass(value: string): string {
  const amount = BigInt(value);
  return amount > 0n ? 'positive' : amount < 0n ? 'negative' : 'muted';
}
