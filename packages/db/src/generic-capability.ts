/** Server-owned administrative control and identity-independent trading policy; app_meta is nonfinancial. No balance/fill mutations. */
import { randomUUID } from 'node:crypto';
import { ExecutionEngineError } from '@paperfund/execution';
import { genericActor, type GenericPermission } from '@paperfund/protocols';
import type { DatabaseService } from './database.js';
export type GenericMode = 'ENTRY' | 'EXIT_ONLY' | 'HARD_STOP';
export interface GenericCapabilityOptions {
  armed: boolean;
  entries: boolean;
  /** Legacy configuration name; administrative authority only, never trading entitlement. */
  operatorIds: readonly string[];
  /** Omitted/false is exit-only even with a legacy unexpired ENTRY record. */
  normalUserAccess?: boolean;
  entrySeconds: number;
  systemSettlement?: boolean;
}
const KEY = 'generic_pumpswap_operator_control_v1';
const ID = /^user:[a-f0-9]{64}$/;
function deny(reason: string): never {
  throw new ExecutionEngineError('POSITION_EXECUTION_ROUTE_UNAVAILABLE', reason);
}
export function genericCapabilityOptions(config: unknown): GenericCapabilityOptions {
  const c = config as Record<string, unknown>;
  return {
    armed: c['GENERIC_PUMPSWAP_ENABLED'] === true,
    entries: c['GENERIC_PUMPSWAP_BUYS_ENABLED'] === true,
    normalUserAccess: c['GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED'] === true,
    operatorIds: Array.isArray(c['GENERIC_PUMPSWAP_OPERATOR_USER_IDS'])
      ? (c['GENERIC_PUMPSWAP_OPERATOR_USER_IDS'] as string[])
      : [],
    entrySeconds:
      typeof c['GENERIC_PUMPSWAP_ENTRY_SECONDS'] === 'number'
        ? c['GENERIC_PUMPSWAP_ENTRY_SECONDS']
        : 900,
  };
}
export class GenericCapability {
  private readonly controllers: Set<string>;
  constructor(
    private db: DatabaseService,
    readonly options: GenericCapabilityOptions,
    private now: () => number = Date.now,
  ) {
    if (options.operatorIds.length > 1 || options.operatorIds.some((id) => !ID.test(id)))
      throw Error('GENERIC_OPERATOR_SCOPE_INVALID');
    if (options.entries && (!options.armed || options.operatorIds.length === 0))
      throw Error('GENERIC_ENTRY_REQUIRES_OPERATOR');
    this.controllers = new Set(options.operatorIds);
  }
  private async mode(): Promise<GenericMode> {
    if (!this.options.armed) return 'HARD_STOP';
    const r = await this.db.pool.query<{ value: string }>({
      text: 'select value from app_meta where key=$1',
      values: [KEY],
      query_timeout: 600,
    } as never);
    if (!r.rows[0]) return 'EXIT_ONLY';
    try {
      const v = JSON.parse(r.rows[0].value) as {
        schema?: string;
        mode?: string;
        expiresAt?: number;
      };
      if (v.schema !== 'GENERIC_OPERATOR_CONTROL_V1') return 'HARD_STOP';
      if (v.mode === 'HARD_STOP' || v.mode === 'EXIT_ONLY') return v.mode;
      if (v.mode === 'ENTRY' && typeof v.expiresAt === 'number')
        return v.expiresAt > this.now() ? 'ENTRY' : 'EXIT_ONLY';
    } catch {
      /* Malformed control is a hard stop, never a grant. */
    }
    return 'HARD_STOP';
  }
  async status(userId: string) {
    const mode = await this.mode();
    return {
      userId,
      armed: this.options.armed,
      // Compatibility field now describes uniform trading access, not a role.
      entitled: this.options.armed && this.options.normalUserAccess === true,
      canControl: this.controllers.has(userId),
      mode,
      entriesEnabled:
        this.options.armed &&
        this.options.entries &&
        this.options.normalUserAccess === true &&
        mode === 'ENTRY',
      exitPolicy: 'OWNED_IMMUTABLE_GENERIC_FILL_AND_FRESH_ROUTE' as const,
    };
  }
  async control(userId: string, mode: GenericMode) {
    if (!this.controllers.has(userId)) deny('GENERIC_OPERATOR_ENTITLEMENT_REQUIRED');
    if (!this.options.armed) deny('GENERIC_CAPABILITY_NOT_ARMED');
    if (mode === 'ENTRY' && (!this.options.entries || this.options.normalUserAccess !== true))
      deny('GENERIC_ENTRY_NOT_ARMED');
    if (!['ENTRY', 'EXIT_ONLY', 'HARD_STOP'].includes(mode)) deny('GENERIC_CONTROL_INVALID');
    const record = {
      schema: 'GENERIC_OPERATOR_CONTROL_V1',
      mode,
      actorUserId: userId,
      version: randomUUID(),
      at: new Date(this.now()).toISOString(),
      expiresAt: mode === 'ENTRY' ? this.now() + this.options.entrySeconds * 1000 : null,
    };
    await this.db.pool.query(
      'insert into app_meta(key,value) values($1,$2) on conflict(key) do update set value=excluded.value,updated_at=now()',
      [KEY, JSON.stringify(record)],
    );
    return this.status(userId);
  }
  private async exitPosition(
    mint: string,
    userId: string | undefined,
    system: boolean,
    accountId: string | undefined,
    forSettlement: boolean,
  ) {
    // Latest BUY for this owner and asset; never reuse another owner's entitlement or old reserves.
    const r = await this.db.pool.query<{
      protocol: string | null;
      evidence_protocol: string;
      adapter: string;
      normalization: string;
      quote: string | null;
      bridge: string | null;
      target: string | null;
      mint: string | null;
    }>({
      text: `select f.protocol_id protocol,e.protocol_id evidence_protocol,e.adapter_version adapter,e.normalization_version normalization,e.normalized_state->'stage1Snapshot'->>'quoteMint' quote,
    e.normalized_state->'stage1Snapshot'->>'bridgePool' bridge,e.normalized_state->'stage1Snapshot'->>'targetPool' target,
    e.normalized_state->'stage1Snapshot'->>'mint' mint
    from positions p join competition_accounts ca on ca.id=p.competition_account_id join hourly_rounds h on h.id=ca.hourly_round_id join assets a on a.id=p.asset_id
    join lateral(select x.* from fills x join orders o on o.id=x.order_id join markets m on m.id=x.market_id
      where o.competition_account_id=ca.id and m.base_asset_id=p.asset_id and x.side='BUY' and x.base_quantity>0 and o.status='COMPLETED'
      order by x.executed_at desc,x.id desc limit 1) f on true
    join market_state_evidence e on e.id=f.market_state_evidence_id and e.market_id=f.market_id and e.protocol_id=f.protocol_id
    where a.mint_address=$1 and p.status='OPEN' and p.remaining_base_units>0
      and ($3::boolean or ca.user_id=$2::text) and ($4::text is null or ca.id=$4::text)
      and ca.final_settled_balance_lamports is null
      and (($6::boolean and h.state='SETTLING' and h.ends_at_exclusive<=$5)
        or (not $6::boolean and h.state='OPEN' and h.starts_at<=$5 and h.ends_at_exclusive>$5))
    order by f.executed_at desc,f.id desc limit 1`,
      values: [
        mint,
        userId ?? null,
        system,
        accountId ?? null,
        new Date(this.now()),
        forSettlement,
      ],
      query_timeout: 600,
    } as never);
    const row = r.rows[0];
    if (!row) return undefined;
    // An immutable BUY proves position provenance, not the current execution venue.
    // Legacy positions must independently discover/validate their migrated canonical route.
    if (row.protocol !== row.evidence_protocol || !row.adapter || !row.normalization)
      deny('GENERIC_EXIT_EVIDENCE_INVALID');
    if (row.protocol !== 'GENERIC_PUMP_SWAP') return { binding: undefined };
    if (
      row.evidence_protocol !== 'GENERIC_PUMP_SWAP' ||
      row.adapter !== 'generic-pump-swap-orca-v1' ||
      row.normalization !== 'generic-pump-swap-accounts-v1' ||
      row.mint !== mint ||
      !row.quote ||
      !row.bridge ||
      !row.target
    )
      deny('GENERIC_EXIT_EVIDENCE_INVALID');
    return { binding: { quoteMint: row.quote, bridgePool: row.bridge, targetPool: row.target } };
  }
  async resolve(mint: string, quote: string, forSettlement: boolean): Promise<GenericPermission> {
    if (!this.options.armed) return { discover: false, buy: false };
    const actor = genericActor(),
      system =
        (this.options.systemSettlement === true && forSettlement) || actor?.systemRead === true;
    if (!actor?.userId && !system) return { discover: false, buy: false };
    if (system && !actor?.accountId) deny('GENERIC_SYSTEM_ACCOUNT_SCOPE_REQUIRED');
    if (actor?.accountId && !system) {
      const own = await this.db.pool.query(
        'select id from competition_accounts where id=$1 and user_id=$2',
        [actor.accountId, actor.userId],
      );
      if (!own.rows[0]) deny('GENERIC_ACCOUNT_OWNER_MISMATCH');
    }
    const mode = await this.mode();
    if (mode === 'HARD_STOP') deny('GENERIC_HARD_STOP');
    const eligible = !!actor?.userId && this.options.normalUserAccess === true,
      position = await this.exitPosition(
        mint,
        actor?.userId,
        system,
        actor?.accountId,
        forSettlement,
      ),
      binding = position?.binding;
    if (binding && binding.quoteMint !== quote) deny('GENERIC_EXIT_QUOTE_CHANGED');
    const buy = !system && eligible && this.options.entries && mode === 'ENTRY';
    const authorizeLive = async (kind: 'BUY' | 'SELL') => {
      if (kind === 'BUY' && actor?.intent !== 'BUY') deny('GENERIC_READ_SCOPE_CANNOT_EXECUTE');
      if (kind === 'SELL' && !forSettlement && actor?.intent !== 'SELL')
        deny('GENERIC_READ_SCOPE_CANNOT_EXECUTE');
      const fresh = await this.mode();
      if (fresh === 'HARD_STOP') deny('GENERIC_HARD_STOP');
      if (
        kind === 'BUY' &&
        (!buy ||
          !this.options.entries ||
          this.options.normalUserAccess !== true ||
          fresh !== 'ENTRY')
      )
        deny('GENERIC_OPERATOR_ENTRY_DISABLED');
      if (kind === 'SELL') {
        const current = await this.exitPosition(
          mint,
          actor?.userId,
          system,
          actor?.accountId,
          forSettlement,
        );
        if (!position || !current) deny('GENERIC_OWNED_EXIT_EVIDENCE_REQUIRED');
        if (JSON.stringify(current.binding) !== JSON.stringify(binding))
          deny('GENERIC_EXIT_EVIDENCE_CHANGED');
      }
    };
    if (binding) return { discover: false, buy, exitBinding: binding, authorizeLive };
    if (position || (eligible && !system)) return { discover: true, buy, authorizeLive };
    return { discover: false, buy: false };
  }
}
