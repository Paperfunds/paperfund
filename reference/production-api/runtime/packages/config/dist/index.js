import { validateNonSolPumpSwapRoutes } from './non-sol-pumpswap-routes.js';
export { APPROVED_NON_SOL_PUMPSWAP_ROUTES, validateNonSolPumpSwapRoutes, } from './non-sol-pumpswap-routes.js';
import { z } from 'zod';
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
const solanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function isSecurePublicOrigin(value) {
    try {
        const url = new URL(value);
        return (url.protocol === 'https:' &&
            !['localhost', '127.0.0.1', '::1'].includes(url.hostname) &&
            value === url.origin);
    }
    catch {
        return false;
    }
}
function isExactExtensionOrigin(value) {
    return /^chrome-extension:\/\/[a-p]{32}$/.test(value);
}
export const environmentSchema = z
    .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    PRIVATE_BETA_NON_PAYING: z
        .enum(['true', 'false'])
        .default('true')
        .transform((v) => v === 'true'),
    BETA_INVITE_ONLY: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    BETA_WALLET_ALLOWLIST: z
        .string()
        .default('')
        .transform((v, ctx) => {
        const wallets = v
            .split(',')
            .map((w) => w.trim())
            .filter(Boolean);
        if (wallets.some((w) => !solanaAddress.test(w)) ||
            new Set(wallets).size !== wallets.length) {
            ctx.addIssue({
                code: 'custom',
                message: 'Beta allowlist requires unique public Solana addresses.',
            });
            return z.NEVER;
        }
        return wallets;
    }),
    API_PUBLIC_ORIGIN: z.string().default(''),
    APP_PUBLIC_ORIGIN: z.string().default(''),
    DATABASE_URL: z.string().url().startsWith('postgresql://'),
    REDIS_URL: z
        .string()
        .url()
        .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
        message: 'REDIS_URL must use the redis:// or rediss:// protocol',
    }),
    NON_SOL_PUMPSWAP_ALLOWED_ROUTES: z
        .string()
        .default('')
        .transform((v, ctx) => {
        if (v === '')
            return [];
        try {
            return validateNonSolPumpSwapRoutes(JSON.parse(v));
        }
        catch {
            ctx.addIssue({
                code: 'custom',
                message: 'Non-SOL allowlist must contain complete approved route identities',
            });
            return z.NEVER;
        }
    }),
    NON_SOL_PUMPSWAP_ENABLED: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    GENERIC_PUMPSWAP_ENABLED: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    GENERIC_PUMPSWAP_BUYS_ENABLED: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    // Explicit rollout gate: legacy operator arming never opens ordinary-user access.
    GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    // Retained configuration name; IDs authorize administrative controls only.
    GENERIC_PUMPSWAP_OPERATOR_USER_IDS: z
        .string()
        .default('')
        .transform((v, ctx) => {
        if (v === '')
            return [];
        try {
            const ids = JSON.parse(v);
            if (!Array.isArray(ids) ||
                ids.length > 1 ||
                ids.some((id) => typeof id !== 'string' || !/^user:[a-f0-9]{64}$/.test(id)))
                throw Error();
            return ids;
        }
        catch {
            ctx.addIssue({
                code: 'custom',
                message: 'Generic control authority requires at most one exact authenticated internal user ID',
            });
            return z.NEVER;
        }
    }),
    GENERIC_PUMPSWAP_ENTRY_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    SOLANA_RPC_URL: z.string().url().default('https://api.mainnet-beta.solana.com'),
    SOLANA_WS_URL: z
        .string()
        .refine((v) => v === '' ||
        (() => {
            try {
                return new URL(v).protocol === 'wss:';
            }
            catch {
                return false;
            }
        })(), { message: 'SOLANA_WS_URL must use wss://' })
        .default(''),
    ADVISORY_MAX_CONCURRENT: z.coerce.number().int().min(2).max(64).default(4),
    ADVISORY_BACKGROUND_CONCURRENT: z.coerce.number().int().min(1).max(8).default(2),
    API_RATE_LIMIT_VALUATION_MAX: z.coerce.number().int().positive().default(240),
    VALUATION_DIAGNOSTICS_ENABLED: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
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
    WORKER_HEARTBEAT_FILE: z.string().min(1).default('logs/worker-heartbeat.json'),
    REWARD_ALLOCATION_MODE: z.enum(['NORMAL', 'BUFFER_ACCUMULATION']).default('NORMAL'),
    REWARD_BASELINE_WINDOW: z.coerce.number().int().positive().default(12),
    REWARD_LAMBDA_BPS: z.coerce.number().int().min(0).max(10_000).default(6_000),
    REWARD_FINALIZATION_GRACE_SECONDS: z.coerce.number().int().min(0).default(60),
    CREATOR_FEE_INGESTION_ENABLED: z
        .enum(['true', 'false'])
        .default('false')
        .transform((value) => value === 'true'),
    CREATOR_FEE_SHADOW_MODE: z
        .enum(['true', 'false'])
        .default('true')
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
    PAYOUT_MAX_RECIPIENTS_PER_BATCH: z.coerce.number().int().min(1).max(12).default(8),
    PAYOUT_MAINNET_MAX_PLAN_LAMPORTS: z
        .string()
        .regex(/^\d+$/)
        .refine((value) => BigInt(value) > 0n, 'Mainnet payout cap must be positive.')
        .default('100000000'),
})
    .superRefine((value, context) => {
    for (const [path, address] of [
        ['PAPERFUND_TOKEN_MINT', value.PAPERFUND_TOKEN_MINT],
        ['PAPERFUND_CREATOR_WALLET', value.PAPERFUND_CREATOR_WALLET],
        ['PAYOUT_TREASURY_PUBLIC_KEY', value.PAYOUT_TREASURY_PUBLIC_KEY],
    ]) {
        if (address && !solanaAddress.test(address))
            context.addIssue({
                code: 'custom',
                path: [path],
                message: `${path} is not a Solana address.`,
            });
    }
    if (value.CREATOR_FEE_INGESTION_ENABLED &&
        (!value.PAPERFUND_TOKEN_MINT || !value.PAPERFUND_CREATOR_WALLET))
        context.addIssue({
            code: 'custom',
            path: ['CREATOR_FEE_INGESTION_ENABLED'],
            message: 'Live creator-fee ingestion requires the token mint and creator wallet.',
        });
    if (value.PAYOUT_EXECUTION_ENABLED) {
        if (!value.PAYOUT_TREASURY_PUBLIC_KEY)
            context.addIssue({
                code: 'custom',
                path: ['PAYOUT_TREASURY_PUBLIC_KEY'],
                message: 'Live payouts require a treasury.',
            });
        if (value.PAYOUT_SIGNER_TYPE === 'DISABLED')
            context.addIssue({
                code: 'custom',
                path: ['PAYOUT_SIGNER_TYPE'],
                message: 'Live payouts require a separately authorized signer boundary.',
            });
        if (value.PAYOUT_NETWORK === 'mainnet-beta' && !value.PAYOUT_MAINNET_CONFIRM)
            context.addIssue({
                code: 'custom',
                path: ['PAYOUT_MAINNET_CONFIRM'],
                message: 'Mainnet payouts require explicit confirmation.',
            });
    }
    if (value.NODE_ENV === 'production') {
        if (!isSecurePublicOrigin(value.API_PUBLIC_ORIGIN))
            context.addIssue({
                code: 'custom',
                path: ['API_PUBLIC_ORIGIN'],
                message: 'Production API origin must be non-loopback HTTPS.',
            });
        if (!isSecurePublicOrigin(value.APP_PUBLIC_ORIGIN))
            context.addIssue({
                code: 'custom',
                path: ['APP_PUBLIC_ORIGIN'],
                message: 'Production app origin must be non-loopback HTTPS.',
            });
        if (!value.COOKIE_SECURE)
            context.addIssue({
                code: 'custom',
                path: ['COOKIE_SECURE'],
                message: 'Production cookies must be secure.',
            });
        for (const origin of value.ALLOWED_ORIGINS.split(',').map((item) => item.trim())) {
            if (!isSecurePublicOrigin(origin) && !isExactExtensionOrigin(origin))
                context.addIssue({
                    code: 'custom',
                    path: ['ALLOWED_ORIGINS'],
                    message: 'Production CORS origins must be HTTPS or an exact extension origin.',
                });
        }
        if (!value.ALLOWED_ORIGINS.split(',')
            .map((item) => item.trim())
            .includes(value.APP_PUBLIC_ORIGIN))
            context.addIssue({
                code: 'custom',
                path: ['ALLOWED_ORIGINS'],
                message: 'Production CORS must include APP_PUBLIC_ORIGIN.',
            });
    }
})
    .readonly();
export function parseEnvironment(environment) {
    const parsed = environmentSchema.parse(environment);
    if (parsed.PAYOUT_EXECUTION_ENABLED && !environment.PAYOUT_NETWORK)
        throw new Error('PAYOUT_NETWORK must be explicitly set when live payout execution is enabled.');
    if (parsed.GENERIC_PUMPSWAP_BUYS_ENABLED &&
        parsed.GENERIC_PUMPSWAP_OPERATOR_USER_IDS.length === 0)
        throw Error('Generic entry arming requires explicit administrative control authority');
    if (parsed.GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED && !parsed.GENERIC_PUMPSWAP_ENABLED)
        throw Error('Normal-user generic access requires generic routing enabled');
    if (parsed.GENERIC_PUMPSWAP_BUYS_ENABLED && !parsed.GENERIC_PUMPSWAP_ENABLED)
        throw Error('Generic BUY requires generic routing enabled');
    if (parsed.NON_SOL_PUMPSWAP_ENABLED && parsed.NON_SOL_PUMPSWAP_ALLOWED_ROUTES.length === 0)
        throw Error('Enabled non-SOL capability requires an explicit approved allowlist');
    return parsed;
}
export function parseApplicationEnvironment(environment) {
    // Presence is checked without reading a private credential value. Never load a shared dotenv here.
    for (const name of [
        'PAYOUT_SIGNER_SECRET_KEY',
        'PAYOUT_SIGNER_SECRET_FILE',
        'PAYOUT_OPERATOR_PRIVATE_KEY',
        'PAYOUT_OPERATOR_TOKEN',
    ])
        if (Object.prototype.hasOwnProperty.call(environment, name))
            throw new Error('Signer/operator credentials are forbidden in ordinary application processes.');
    const parsed = parseEnvironment(environment);
    if (!parsed.BETA_INVITE_ONLY)
        throw new Error('This private beta requires invite-only access. An empty allowlist denies all testers.');
    if (!parsed.PRIVATE_BETA_NON_PAYING ||
        parsed.PAYOUT_EXECUTION_ENABLED ||
        parsed.PAYOUT_SIGNER_TYPE !== 'DISABLED')
        throw new Error('This release is non-paying only; real-SOL runtime qualification is unavailable.');
    return parsed;
}
//# sourceMappingURL=index.js.map