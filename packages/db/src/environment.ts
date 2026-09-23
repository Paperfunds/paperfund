import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

import { parseEnvironment } from '@paperfund/config';

export function loadRepositoryEnvironment() {
  const environmentFile = fileURLToPath(new URL('../../../.env', import.meta.url));
  loadDotenv({ path: environmentFile, quiet: true });
  return parseEnvironment(process.env);
}
