import { expect, it, vi } from 'vitest';
const captures = vi.hoisted(() => ({ logs: [] as string[], heartbeat: [] as string[] }));
const key = 'SyntheticWorkerCredential_c395eb70fe764da697422b6bc4b8de25';
const endpoint = 'https://mainnet.helius-rpc.com/?api-key=' + key;
vi.mock('@paperfund/config', () => ({
  parseEnvironment: () => ({
    DATABASE_URL: 'fixture',
    SOLANA_RPC_URL:
      'https://mainnet.helius-rpc.com/?api-key=SyntheticWorkerCredential_c395eb70fe764da697422b6bc4b8de25',
    WORKER_HEARTBEAT_FILE: 'fixture',
    WORKER_TICK_INTERVAL_MS: 1000,
    CREATOR_FEE_INGESTION_ENABLED: false,
    NON_SOL_PUMPSWAP_ALLOWED_ROUTES: [],
    GENERIC_PUMPSWAP_OPERATOR_USER_IDS: [],
  }),
}));
vi.mock('@paperfund/db', () => ({
  createDatabase: () => ({ close: async () => {} }),
  GenericCapability: class {},
  genericCapabilityOptions: () => ({}),
  recordCreatorFeeIngestionFailure: vi.fn(),
  recordCreatorFeeIngestionRetries: vi.fn(),
  runCreatorFeeIngestionTick: vi.fn(),
  runDailyRewardFinalizationTick: vi.fn(),
  runHourlyLifecycleTick: async () => {
    throw Object.assign(
      new Error(
        'HTTP 401 https://mainnet.helius-rpc.com/?api-key=SyntheticWorkerCredential_c395eb70fe764da697422b6bc4b8de25',
      ),
      { code: 'RPC_UNAVAILABLE' },
    );
  },
  runPayoutPlanGenerationTick: vi.fn(),
  runRewardFinalizationTick: vi.fn(),
  SolanaJsonRpcClient: class {},
  SolanaPumpCreatorFeeSource: class {},
}));
vi.mock('@paperfund/protocols', () => ({ createProductionExecutionRouter: () => ({}) }));
vi.mock('node:fs/promises', () => ({
  mkdir: async () => {},
  rename: async () => {},
  writeFile: async (_path: string, data: string) => {
    captures.heartbeat.push(data);
  },
}));
it('actual worker entrypoint log and heartbeat failure outputs redact credentials', async () => {
  vi.stubEnv('SOLANA_RPC_URL', endpoint);
  vi.useFakeTimers();
  const info = vi.spyOn(console, 'info').mockImplementation((x) => captures.logs.push(String(x)));
  const error = vi.spyOn(console, 'error').mockImplementation((x) => captures.logs.push(String(x)));
  const oldInt = process.listeners('SIGINT'),
    oldTerm = process.listeners('SIGTERM');
  try {
    await import('../src/index.js');
    const text = captures.logs.join('') + captures.heartbeat.join('');
    expect(text.includes(key)).toBe(false);
    expect(text.includes(endpoint)).toBe(false);
    expect(text.includes('round_lifecycle_tick_failed')).toBe(true);
    expect(captures.heartbeat.length).toBeGreaterThan(0);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    info.mockRestore();
    error.mockRestore();
    vi.unstubAllEnvs();
    for (const fn of process.listeners('SIGINT'))
      if (!oldInt.includes(fn)) process.removeListener('SIGINT', fn);
    for (const fn of process.listeners('SIGTERM'))
      if (!oldTerm.includes(fn)) process.removeListener('SIGTERM', fn);
  }
});
