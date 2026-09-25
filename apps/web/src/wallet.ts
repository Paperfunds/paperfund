import type { InjectedWallet } from './types.js';

export function getInjectedWallet(): InjectedWallet | null {
  return window.phantom?.solana ?? window.solana ?? null;
}

export function encodeBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let result = '';
  while (value > 0n) {
    result = alphabet[Number(value % 58n)] + result;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte === 0) result = `1${result}`;
    else break;
  }
  return result || '1';
}
