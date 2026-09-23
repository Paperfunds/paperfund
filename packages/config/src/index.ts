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
    LOG_LEVEL: z.enum(logLevels).default('info'),
  })
  .readonly();

export type AppConfig = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): AppConfig {
  return environmentSchema.parse(environment);
}
