import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadDotenv({ path: '../../.env', quiet: true });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://paperfund:paperfund@127.0.0.1:5432/paperfund',
  },
  strict: true,
  verbose: true,
});
