import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';

import type { DatabaseService } from '@paperfund/db';

import type { RedisService } from './redis.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface AuthenticatedUser {
  readonly id: string;
  readonly walletAddress: string;
}

interface ChallengeRecord {
  readonly walletAddress: string;
  readonly message: string;
  readonly expiresAt: string;
}

interface SessionRecord extends AuthenticatedUser {
  readonly expiresAt: string;
}

function decodeBase58(value: string): Buffer {
  if (!value || [...value].some((character) => !BASE58_ALPHABET.includes(character))) {
    throw new Error('Invalid base58 value.');
  }
  let number = 0n;
  for (const character of value) {
    number = number * 58n + BigInt(BASE58_ALPHABET.indexOf(character));
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.push(Number(number % 256n));
    number /= 256n;
  }
  for (const character of value) {
    if (character !== '1') break;
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}

export function isSolanaPublicKey(value: string): boolean {
  try {
    return decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}

function decodeSignature(value: string): Buffer {
  try {
    const base58 = decodeBase58(value);
    if (base58.length === 64) return base58;
  } catch {
    // Try base64 for clients that serialize wallet signatures that way.
  }
  const base64 = Buffer.from(value, 'base64');
  if (
    base64.length !== 64 ||
    base64.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')
  ) {
    throw new Error('Signature must be a 64-byte base58 or base64 value.');
  }
  return base64;
}

export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly challengeTtlSeconds: number,
    private readonly sessionTtlSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createChallenge(walletAddress: string) {
    if (!isSolanaPublicKey(walletAddress)) throw new Error('Invalid Solana wallet address.');
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + this.challengeTtlSeconds * 1000);
    const nonce = randomBytes(32).toString('base64url');
    const challengeId = randomUUID();
    const message = [
      'Paperfund Authentication',
      'Purpose: Sign in to Paperfund (message only; no transaction)',
      `Wallet: ${walletAddress}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt.toISOString()}`,
      `Expires At: ${expiresAt.toISOString()}`,
    ].join('\n');
    const record: ChallengeRecord = { walletAddress, message, expiresAt: expiresAt.toISOString() };
    await this.redis.setExpiring(
      `auth:challenge:${challengeId}`,
      JSON.stringify(record),
      this.challengeTtlSeconds,
    );
    return { challengeId, message, issuedAt, expiresAt };
  }

  async verifyChallenge(input: {
    walletAddress: string;
    challengeId: string;
    message: string;
    signature: string;
  }) {
    if (!isSolanaPublicKey(input.walletAddress)) throw new Error('Invalid Solana wallet address.');
    const raw = await this.redis.take(`auth:challenge:${input.challengeId}`);
    if (!raw) throw new Error('Challenge is invalid, expired, or already used.');
    const challenge = JSON.parse(raw) as ChallengeRecord;
    if (
      challenge.walletAddress !== input.walletAddress ||
      challenge.message !== input.message ||
      this.now() >= new Date(challenge.expiresAt)
    )
      throw new Error('Challenge validation failed.');
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, decodeBase58(input.walletAddress)]),
      format: 'der',
      type: 'spki',
    });
    if (
      !verify(
        null,
        Buffer.from(challenge.message, 'utf8'),
        publicKey,
        decodeSignature(input.signature),
      )
    ) {
      throw new Error('Wallet signature is invalid.');
    }
    const id = `user:${createHash('sha256').update(input.walletAddress).digest('hex')}`;
    await this.database.pool.query(
      `insert into users (id, wallet_address) values ($1, $2)
       on conflict (wallet_address) do nothing`,
      [id, input.walletAddress],
    );
    const user = (
      await this.database.pool.query<{ id: string; wallet_address: string }>(
        'select id, wallet_address from users where wallet_address = $1',
        [input.walletAddress],
      )
    ).rows[0]!;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + this.sessionTtlSeconds * 1000);
    const session: SessionRecord = {
      id: user.id,
      walletAddress: user.wallet_address,
      expiresAt: expiresAt.toISOString(),
    };
    await this.redis.setExpiring(
      `auth:session:${token}`,
      JSON.stringify(session),
      this.sessionTtlSeconds,
    );
    return { token, user: { id: session.id, walletAddress: session.walletAddress }, expiresAt };
  }

  async authenticate(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token) return null;
    const raw = await this.redis.get(`auth:session:${token}`);
    if (!raw) return null;
    const session = JSON.parse(raw) as SessionRecord;
    return this.now() < new Date(session.expiresAt)
      ? { id: session.id, walletAddress: session.walletAddress }
      : null;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.redis.delete(`auth:session:${token}`);
  }
}
