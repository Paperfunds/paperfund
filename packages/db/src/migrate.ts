import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase } from './database.js';
import { loadRepositoryEnvironment } from './environment.js';

const config = loadRepositoryEnvironment();
const database = createDatabase(config.DATABASE_URL);
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

try {
  await migrate(database.client, { migrationsFolder });
  process.stdout.write('Database migrations applied successfully.\n');
} finally {
  await database.close();
}
