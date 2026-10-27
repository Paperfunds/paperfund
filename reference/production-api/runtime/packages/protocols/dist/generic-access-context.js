import { AsyncLocalStorage } from 'node:async_hooks';
export const DENY_GENERIC = Object.freeze({ discover: false, buy: false });
const actorKey = Symbol.for('paperfund.generic.actor.v1'), operationKey = Symbol.for('paperfund.generic.operation.v1');
const globals = globalThis;
const actors = globals[actorKey] ??
    new AsyncLocalStorage();
const operations = globals[operationKey] ??
    new AsyncLocalStorage();
globals[actorKey] = actors;
globals[operationKey] = operations;
export const genericActor = () => actors.getStore();
export const withGenericActor = (actor, work) => actors.run(Object.freeze({ ...actor }), work);
export const withGenericSystemRead = (work, isolateCaptures = false) => withGenericActor({ intent: 'READ', systemRead: true, isolateCaptures }, work);
export const withGenericAccount = (accountId, work) => withGenericActor({ ...(genericActor() ?? { intent: 'READ' }), accountId }, work);
export const withGenericOperation = (settlement, work) => operations.run({ settlement, permission: DENY_GENERIC }, work);
export const genericOperation = () => operations.getStore();
export function recordGenericPermission(permission) {
    const op = operations.getStore();
    if (!op)
        throw Error('GENERIC_OPERATION_SCOPE_MISSING');
    op.permission = Object.freeze({ ...permission });
}
//# sourceMappingURL=generic-access-context.js.map