import { expect, it, vi } from 'vitest';
const key = 'SyntheticOpsCredential_23babd66f6474f0ab65c3b821d3d7e97';
const endpoint = 'https://mainnet.helius-rpc.com/?api-key=' + key;
vi.mock('@paperfund/config', () => ({
  parseEnvironment: () => ({
    NODE_ENV: 'development',
    DATABASE_URL: 'fixture',
    REDIS_URL: 'fixture',
    SOLANA_RPC_URL:
      'https://mainnet.helius-rpc.com/?api-key=SyntheticOpsCredential_23babd66f6474f0ab65c3b821d3d7e97',
    SOLANA_RPC_TIMEOUT_MS: 1000,
    API_HOST: '127.0.0.1',
    API_PORT: 3000,
    WORKER_HEARTBEAT_FILE: 'fixture',
    WORKER_TICK_INTERVAL_MS: 1000,
    CREATOR_FEE_INGESTION_ENABLED: false,
    PAYOUT_EXECUTION_ENABLED: false,
    PAYOUT_NETWORK: 'localnet',
    ALLOWED_ORIGINS: 'https://app.paperfund.app',
  }),
}));
vi.mock('@paperfund/db', () => ({
  createDatabase: () => ({
    pool: { query: async () => ({ rows: [{ count: '12' }] }) },
    close: async () => {},
  }),
}));
vi.mock('ioredis', () => ({
  Redis: class {
    async connect() {}
    async ping() {
      return 'PONG';
    }
    async quit() {}
  },
}));
vi.mock('node:fs/promises', () => ({
  readFile: async () =>
    JSON.stringify({
      entries: Array(12).fill({}),
      lastTickStartedAt: new Date().toISOString(),
      lastError: {
        message:
          'https://mainnet.helius-rpc.com/?api-key=SyntheticOpsCredential_23babd66f6474f0ab65c3b821d3d7e97',
      },
    }),
}));
it('actual ops:check stdout scrubs provider failures and stored heartbeat detail', async () => {
  vi.stubEnv('SOLANA_RPC_URL', endpoint);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 401, message: 'HTTP 401 ' + endpoint + ' ' + key } }),
        ),
    ),
  );
  let output = '';
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  const previous = process.exitCode;
  try {
    await import('./ops-check.js');
    expect(output.includes(key)).toBe(false);
    expect(output.includes(endpoint)).toBe(false);
    expect(output.includes('solanaRpc')).toBe(true);
    expect(output.includes('401')).toBe(true);
  } finally {
    write.mockRestore();
    process.exitCode = previous;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
