import { createDatabase } from './database.js';
import { loadRepositoryEnvironment } from './environment.js';

const config = loadRepositoryEnvironment();
const database = createDatabase(config.DATABASE_URL);

try {
  const healthy = await database.healthCheck();
  if (!healthy) {
    throw new Error('Database readiness check failed.');
  }
  process.stdout.write('Database readiness check passed.\n');
} finally {
  await database.close();
}
