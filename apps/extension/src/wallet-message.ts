const HEADER = 'Paperfund Authentication';
const PURPOSE = 'Purpose: Sign in to Paperfund (message only; no transaction)';

export function isPaperfundAuthMessage(message: string, walletAddress: string): boolean {
  if (message.length === 0 || message.length > 2_048) return false;
  const lines = message.split('\n');
  if (
    lines.length !== 6 ||
    lines[0] !== HEADER ||
    lines[1] !== PURPOSE ||
    lines[2] !== `Wallet: ${walletAddress}` ||
    !/^Nonce: [A-Za-z0-9_-]{20,100}$/.test(lines[3] ?? '') ||
    !/^Issued At: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(lines[4] ?? '') ||
    !/^Expires At: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(lines[5] ?? '')
  )
    return false;
  const issuedAt = Date.parse((lines[4] ?? '').slice('Issued At: '.length));
  const expiresAt = Date.parse((lines[5] ?? '').slice('Expires At: '.length));
  return (
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt > issuedAt &&
    expiresAt - issuedAt <= 15 * 60_000
  );
}
