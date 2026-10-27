import { redactDiagnostic, safeErrorMessage } from '@paperfund/core';
const sources = () => [process.env['SOLANA_RPC_URL'], process.env['SOLANA_WS_URL']];
export const safeWorkerErrorMessage = (error: unknown, fallback = 'Unknown worker failure') =>
  safeErrorMessage(error, sources(), fallback);
export const workerDiagnosticJson = (value: unknown) =>
  JSON.stringify(redactDiagnostic(value, sources()));
