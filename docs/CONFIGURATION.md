# Environment configuration

Names come from the validated server schema. Examples contain only local data/placeholders. Browser builds receive explicit public URLs only.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `API_HOST` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `API_PORT` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `PRIVATE_BETA_NON_PAYING` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |
| `BETA_INVITE_ONLY` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `BETA_WALLET_ALLOWLIST` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `API_PUBLIC_ORIGIN` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `APP_PUBLIC_ORIGIN` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `DATABASE_URL` | Server-only: supply local values; keep real credentials outside Git/browser bundles. |
| `REDIS_URL` | Server-only: supply local values; keep real credentials outside Git/browser bundles. |
| `NON_SOL_PUMPSWAP_ALLOWED_ROUTES` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `NON_SOL_PUMPSWAP_ENABLED` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `GENERIC_PUMPSWAP_ENABLED` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `GENERIC_PUMPSWAP_BUYS_ENABLED` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `GENERIC_PUMPSWAP_OPERATOR_USER_IDS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `GENERIC_PUMPSWAP_ENTRY_SECONDS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `SOLANA_RPC_URL` | Server-only: supply local values; keep real credentials outside Git/browser bundles. |
| `SOLANA_WS_URL` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `ADVISORY_MAX_CONCURRENT` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `ADVISORY_BACKGROUND_CONCURRENT` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `API_RATE_LIMIT_VALUATION_MAX` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `VALUATION_DIAGNOSTICS_ENABLED` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `SOLANA_RPC_TIMEOUT_MS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `SOLANA_COMMITMENT` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `LOG_LEVEL` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `AUTH_CHALLENGE_TTL_SECONDS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `AUTH_SESSION_TTL_SECONDS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `COOKIE_SECURE` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `COOKIE_SAME_SITE` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `ALLOWED_ORIGINS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `API_RATE_LIMIT_WINDOW_SECONDS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `API_RATE_LIMIT_AUTH_MAX` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `API_RATE_LIMIT_TRADE_MAX` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `WORKER_TICK_INTERVAL_MS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `WORKER_HEARTBEAT_FILE` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `REWARD_ALLOCATION_MODE` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `REWARD_BASELINE_WINDOW` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `REWARD_LAMBDA_BPS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `REWARD_FINALIZATION_GRACE_SECONDS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `CREATOR_FEE_INGESTION_ENABLED` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |
| `CREATOR_FEE_SHADOW_MODE` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |
| `CREATOR_FEE_NETWORK` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |
| `PAPERFUND_TOKEN_MINT` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `PAPERFUND_CREATOR_WALLET` | Server configuration; see packages/config/src/index.ts for defaults and constraints. |
| `CREATOR_FEE_PAGE_SIZE` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |
| `CREATOR_FEE_RPC_MAX_ATTEMPTS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |
| `CREATOR_FEE_RPC_MIN_INTERVAL_MS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |
| `PAYOUT_EXECUTION_ENABLED` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |
| `PAYOUT_NETWORK` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |
| `PAYOUT_MAINNET_CONFIRM` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |
| `PAYOUT_TREASURY_PUBLIC_KEY` | Server-only: supply local values; keep real credentials outside Git/browser bundles. Preserve nonpaying defaults for development. |
| `PAYOUT_SIGNER_TYPE` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |
| `PAYOUT_MAX_RECIPIENTS_PER_BATCH` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |
| `PAYOUT_MAINNET_MAX_PLAN_LAMPORTS` | Server configuration; see packages/config/src/index.ts for defaults and constraints. Preserve nonpaying defaults for development. |

Extension `PAPERFUND_API_BASE_URL`, `PAPERFUND_APP_URL` and website `VITE_API_BASE_URL` are public build-time URLs. Never pass server secrets through Vite.

Optional `PAPERFUND_PUMP_V3_IDL_FILE` points to a separately licensed local protocol interface. The reviewed hash remains enforced; no IDL is redistributed.

Isolated runtimes have additional reviewed profile contracts; they are not contributor deployment commands.
