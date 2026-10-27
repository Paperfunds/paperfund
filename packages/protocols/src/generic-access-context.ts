import { AsyncLocalStorage } from 'node:async_hooks';
export interface GenericActor {
  userId?: string;
  intent: 'READ' | 'BUY' | 'SELL';
  systemRead?: boolean;
  accountId?: string;
  isolateCaptures?: boolean;
}
export interface GenericPermission {
  discover: boolean;
  buy: boolean;
  exitBinding?: { quoteMint: string; bridgePool: string; targetPool: string };
  authorizeLive?: (kind: 'BUY' | 'SELL') => Promise<void>;
}
export const DENY_GENERIC: GenericPermission = Object.freeze({ discover: false, buy: false });
const actorKey = Symbol.for('paperfund.generic.actor.v1'),
  operationKey = Symbol.for('paperfund.generic.operation.v1');
const globals = globalThis as unknown as Record<symbol, unknown>;
const actors =
  (globals[actorKey] as AsyncLocalStorage<GenericActor> | undefined) ??
  new AsyncLocalStorage<GenericActor>();
const operations =
  (globals[operationKey] as
    AsyncLocalStorage<{ settlement: boolean; permission: GenericPermission }> | undefined) ??
  new AsyncLocalStorage<{ settlement: boolean; permission: GenericPermission }>();
globals[actorKey] = actors;
globals[operationKey] = operations;
export const genericActor = () => actors.getStore();
export const withGenericActor = <T>(actor: GenericActor, work: () => T): T =>
  actors.run(Object.freeze({ ...actor }), work);
export const withGenericSystemRead = <T>(work: () => T, isolateCaptures = false): T =>
  withGenericActor({ intent: 'READ', systemRead: true, isolateCaptures }, work);
export const withGenericAccount = <T>(accountId: string, work: () => T): T =>
  withGenericActor({ ...(genericActor() ?? { intent: 'READ' }), accountId }, work);
export const withGenericOperation = <T>(settlement: boolean, work: () => T): T =>
  operations.run({ settlement, permission: DENY_GENERIC }, work);
export const genericOperation = () => operations.getStore();
export function recordGenericPermission(permission: GenericPermission) {
  const op = operations.getStore();
  if (!op) throw Error('GENERIC_OPERATION_SCOPE_MISSING');
  op.permission = Object.freeze({ ...permission });
}
