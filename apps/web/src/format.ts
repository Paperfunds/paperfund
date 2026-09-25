const LAMPORTS_PER_SOL = 1_000_000_000n;

export function formatUnits(value: string | bigint, decimals: number, places = 4): string {
  const raw = typeof value === 'bigint' ? value : BigInt(value);
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale)
    .toString()
    .padStart(decimals, '0')
    .slice(0, places)
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}

export function formatSol(value: string | bigint, places = 4): string {
  return `${formatUnits(value, 9, places)} SOL`;
}

export function solTextToLamports(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{0,9})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(fraction.padEnd(9, '0'));
}

export function lamportsToSolInput(value: bigint): string {
  const whole = value / LAMPORTS_PER_SOL;
  const fraction = (value % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function percentageQuantity(quantity: string, percentage: 25 | 50 | 75 | 100): string {
  const total = BigInt(quantity);
  return percentage === 100 ? total.toString() : ((total * BigInt(percentage)) / 100n).toString();
}

export function shorten(value: string, size = 5): string {
  return value.length <= size * 2 + 1 ? value : `${value.slice(0, size)}…${value.slice(-size)}`;
}

export function venueName(protocol?: string): string {
  if (protocol === 'PUMP_FUN') return 'Pump.fun';
  if (protocol === 'PUMP_SWAP') return 'PumpSwap';
  return protocol ?? '—';
}

export function pnlClass(value: string): string {
  const amount = BigInt(value);
  return amount > 0n ? 'positive' : amount < 0n ? 'negative' : 'muted';
}
