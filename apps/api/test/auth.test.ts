import { generateKeyPairSync, sign } from 'node:crypto';

import type { DatabaseService } from '@paperfund/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService, isSolanaPublicKey } from '../src/auth.js';
import type { RedisService } from '../src/redis.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes: Buffer): string {
  let value = BigInt(`0x${bytes.toString('hex')}`);
  let encoded = '';
  while (value > 0n) {
    encoded = ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

function wallet() {
  const keys = generateKeyPairSync('ed25519');
  const der = keys.publicKey.export({ type: 'spki', format: 'der' });
  return {
    address: base58(der.subarray(-32)),
    signature(message: string) {
      return base58(sign(null, Buffer.from(message), keys.privateKey));
    },
  };
}

class MemoryRedis implements RedisService {
  readonly values = new Map<string, string>();
  async healthCheck() {
    return true;
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async setExpiring(key: string, value: string) {
    this.values.set(key, value);
  }
  async take(key: string) {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
  async delete(key: string) {
    this.values.delete(key);
  }
  async incrementWindow() {
    return 1;
  }
  async close() {}
}

describe('wallet authentication', () => {
  let redis: MemoryRedis;
  let now: Date;
  let persistedWallet: string | null;
  let auth: AuthService;

  beforeEach(() => {
    redis = new MemoryRedis();
    now = new Date('2026-09-25T12:00:00.000Z');
    persistedWallet = null;
    const database = {
      pool: {
        async query(text: string, values: unknown[]) {
          if (text.startsWith('insert into users')) persistedWallet = String(values[1]);
          return {
            rows: text.startsWith('select id')
              ? [{ id: 'user:test', wallet_address: persistedWallet }]
              : [],
          };
        },
      },
    } as unknown as DatabaseService;
    auth = new AuthService(database, redis, 300, 3600, () => now);
  });

  it('rejects malformed Solana public keys', async () => {
    expect(isSolanaPublicKey('not-a-wallet')).toBe(false);
    await expect(auth.createChallenge('not-a-wallet')).rejects.toThrow('Invalid Solana wallet');
  });

  it('creates a wallet-bound, expiring Paperfund sign-in message', async () => {
    const signer = wallet();
    const challenge = await auth.createChallenge(signer.address);
    expect(challenge.message).toContain('Paperfund Authentication');
    expect(challenge.message).toContain(`Wallet: ${signer.address}`);
    expect(challenge.message).toContain('Nonce:');
    expect(challenge.expiresAt.toISOString()).toBe('2026-09-25T12:05:00.000Z');
  });

  it('verifies the exact message, creates a session, and revokes it on logout', async () => {
    const signer = wallet();
    const challenge = await auth.createChallenge(signer.address);
    const verified = await auth.verifyChallenge({
      walletAddress: signer.address,
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature: signer.signature(challenge.message),
    });
    await expect(auth.authenticate(verified.token)).resolves.toEqual({
      id: 'user:test',
      walletAddress: signer.address,
    });
    await auth.logout(verified.token);
    await expect(auth.authenticate(verified.token)).resolves.toBeNull();
  });

  it('rejects expiry, wrong messages, wrong wallets, and replay', async () => {
    const signer = wallet();
    const other = wallet();
    const expired = await auth.createChallenge(signer.address);
    now = new Date('2026-09-25T12:05:00.000Z');
    await expect(
      auth.verifyChallenge({
        walletAddress: signer.address,
        challengeId: expired.challengeId,
        message: expired.message,
        signature: signer.signature(expired.message),
      }),
    ).rejects.toThrow('Challenge validation failed');

    now = new Date('2026-09-25T12:00:00.000Z');
    const wrongMessage = await auth.createChallenge(signer.address);
    await expect(
      auth.verifyChallenge({
        walletAddress: signer.address,
        challengeId: wrongMessage.challengeId,
        message: `${wrongMessage.message}!`,
        signature: signer.signature(`${wrongMessage.message}!`),
      }),
    ).rejects.toThrow('Challenge validation failed');

    const wrongWallet = await auth.createChallenge(signer.address);
    await expect(
      auth.verifyChallenge({
        walletAddress: other.address,
        challengeId: wrongWallet.challengeId,
        message: wrongWallet.message,
        signature: other.signature(wrongWallet.message),
      }),
    ).rejects.toThrow('Challenge validation failed');

    const replay = await auth.createChallenge(signer.address);
    const request = {
      walletAddress: signer.address,
      challengeId: replay.challengeId,
      message: replay.message,
      signature: signer.signature(replay.message),
    };
    await auth.verifyChallenge(request);
    await expect(auth.verifyChallenge(request)).rejects.toThrow('already used');
  });
});
