import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const MINT = '3JVd8Z3kEEXBaBoZo9rcWk4MHJPSUAf6zAjvAF5spump';
export const WALLET = 'GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW';
export const GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const DATA = resolve(ROOT, 'artifacts/operator');
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const json = (value) =>
  JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
export async function readSetting(name) {
  if (!['SOLANA_RPC_URL', 'DATABASE_URL', 'REDIS_URL'].includes(name))
    throw Error('SETTING_FORBIDDEN');
  if (process.env[name]) return process.env[name];
  const text = await readFile(resolve(ROOT, '.env'), 'utf8');
  return text
    .split(/\r?\n/)
    .find((l) => l.startsWith(name + '='))
    ?.slice(name.length + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
}
export async function saveEvidence(name, value) {
  if (!/^[a-z0-9-]+$/.test(name)) throw Error('INVALID_EVIDENCE_NAME');
  await mkdir(DATA, { recursive: true });
  const bytes = json(value),
    file = name + '-' + Date.now() + '-' + hash(bytes).slice(0, 12) + '.json';
  await writeFile(resolve(DATA, file), bytes, { flag: 'wx', mode: 0o600 });
  return { file, sha256: hash(bytes) };
}
export function uint(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw Error('UNSAFE_RPC_INTEGER');
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw Error('INVALID_LAMPORTS');
  return BigInt(value);
}
