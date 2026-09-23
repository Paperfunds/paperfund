import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';

export interface DatabaseService {
  readonly client: NodePgDatabase<typeof schema>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

export function createDatabase(databaseUrl: string): DatabaseService {
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on('error', () => {
    // Idle-client failures are surfaced by readiness checks without logging credentials.
  });
  const client = drizzle(pool, { schema });

  return {
    client,
    async healthCheck() {
      try {
        await client.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await pool.end();
    },
  };
}
