import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z.string().url().startsWith('postgresql://'),
    REDIS_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
        message: 'REDIS_URL must use the redis:// or rediss:// protocol',
      }),
    SOLANA_RPC_URL: z.string().url().default('https://api.mainnet-beta.solana.com'),
    SOLANA_RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    SOLANA_COMMITMENT: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed'),
    LOG_LEVEL: z.enum(logLevels).default('info'),
    AUTH_CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
    AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).default(86_400),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
    ALLOWED_ORIGINS: z
      .string()
      .refine((value) => !value.split(',').some((origin) => origin.trim() === '*'), {
        message: 'ALLOWED_ORIGINS must not use a wildcard',
      })
      .default('http://127.0.0.1:5173,http://localhost:5173'),
    API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
    API_RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
    API_RATE_LIMIT_TRADE_MAX: z.coerce.number().int().positive().default(30),
    WORKER_TICK_INTERVAL_MS: z.coerce.number().int().min(500).default(5_000),
    REWARD_ALLOCATION_MODE: z.enum(['NORMAL', 'BUFFER_ACCUMULATION']).default('NORMAL'),
    REWARD_BASELINE_WINDOW: z.coerce.number().int().positive().default(12),
    REWARD_LAMBDA_BPS: z.coerce.number().int().min(0).max(10_000).default(6_000),
    REWARD_FINALIZATION_GRACE_SECONDS: z.coerce.number().int().min(0).default(60),
    CREATOR_FEE_INGESTION_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    CREATOR_FEE_NETWORK: z.enum(['localnet', 'devnet', 'mainnet-beta']).default('mainnet-beta'),
    PAPERFUND_TOKEN_MINT: z.string().default(''),
    PAPERFUND_CREATOR_WALLET: z.string().default(''),
    CREATOR_FEE_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(50),
    CREATOR_FEE_RPC_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
    CREATOR_FEE_RPC_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(75),
    PAYOUT_EXECUTION_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    PAYOUT_NETWORK: z.enum(['localnet', 'devnet', 'mainnet-beta']).default('localnet'),
    PAYOUT_MAINNET_CONFIRM: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    PAYOUT_TREASURY_PUBLIC_KEY: z.string().default(''),
    PAYOUT_SIGNER_TYPE: z.enum(['DISABLED', 'LOCAL_KEYPAIR']).default('DISABLED'),
    PAYOUT_SIGNER_SECRET_KEY: z.string().default(''),
    PAYOUT_MAX_RECIPIENTS_PER_BATCH: z.coerce.number().int().min(1).max(12).default(8),
  })
  .readonly();

export type AppConfig = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): AppConfig {
  return environmentSchema.parse(environment);
}
