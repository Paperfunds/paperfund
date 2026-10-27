import { config as loadDotenv } from 'dotenv';
import { pathToFileURL } from 'node:url';
import { parseEnvironment } from '@paperfund/config';
import { createProductionExecutionRouter } from '@paperfund/protocols';
import { createDatabase } from '../packages/db/src/database.js';
import {
  ONE_TIME_DUST_RESOLUTION,
  resolveOneTimeDustSettlement,
} from '../packages/db/src/financial-service.js';

export function dustResolutionArguments(args: readonly string[]) {
  const result = {
    execute: false,
    operatorIdentifier: '',
    approvalReference: '',
    acknowledgement: '',
  };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (seen.has(flag)) throw new Error('INVALID_OPERATOR_ARGUMENTS');
    seen.add(flag);
    if (flag === '--execute') {
      result.execute = true;
      continue;
    }
    const key =
      flag === '--operator'
        ? 'operatorIdentifier'
        : flag === '--approval'
          ? 'approvalReference'
          : flag === '--confirm'
            ? 'acknowledgement'
            : null;
    const value = args[++index];
    if (!key || !value || value.startsWith('--') || value.length > 200)
      throw new Error('INVALID_OPERATOR_ARGUMENTS');
    result[key] = value;
  }
  if (
    result.execute &&
    (!result.operatorIdentifier.trim() ||
      !result.approvalReference.trim() ||
      result.acknowledgement !== ONE_TIME_DUST_RESOLUTION.reason)
  )
    throw new Error('EXPLICIT_OPERATOR_AUTHORIZATION_REQUIRED');
  return result;
}

async function main() {
  // Parse before loading configuration or opening a connection. Default is dry-run.
  const input = dustResolutionArguments(process.argv.slice(2));
  loadDotenv({ path: '.env', quiet: true });
  const config = parseEnvironment(process.env);
  const database = createDatabase(config.DATABASE_URL);
  try {
    const router = createProductionExecutionRouter({
      rpcUrl: config.SOLANA_RPC_URL,
      rpcTimeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
      commitment: config.SOLANA_COMMITMENT,
    });
    const report = await resolveOneTimeDustSettlement(database, router, {
      ...input,
      payoutExecutionDisabled: config.PAYOUT_EXECUTION_ENABLED === false,
    });
    process.stdout.write(
      `${JSON.stringify({ mode: input.execute ? 'EXECUTE' : 'DRY_RUN', ...report }, null, 2)}\n`,
    );
    if (report.liveExecutionBlocked) process.exitCode = 2;
  } finally {
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    process.stderr.write('Dust resolution aborted; no successful resolution is claimed.\n');
    process.exitCode = 2;
  });
}
