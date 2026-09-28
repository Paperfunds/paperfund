import { createHash } from 'node:crypto';

import { buildPayoutBatches, PAYOUT_INTENT_VERSION, type PayoutNetwork } from '@paperfund/core';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
  type Commitment,
} from '@solana/web3.js';
import bs58 from 'bs58';

import type { DatabaseService } from './database.js';
import { getPayoutPlanAudit, PayoutPlanError, validatePayoutPlan } from './payout-service.js';

export interface PayoutExecutionConfig {
  readonly enabled: boolean;
  readonly network: PayoutNetwork;
  readonly mainnetConfirmed: boolean;
  readonly treasuryAddress: string;
  readonly maxRecipientsPerBatch: number;
}

export interface PreparedTransaction {
  readonly unsignedTransaction: Uint8Array;
  readonly feeLamports: bigint;
  readonly recentBlockhash: string;
  readonly lastValidBlockHeight: bigint;
}

export interface ChainTransfer {
  readonly source: string;
  readonly destination: string;
  readonly lamports: bigint;
}

export interface PayoutRpc {
  assertNetwork(network: PayoutNetwork): Promise<void>;
  getBalance(address: string): Promise<bigint>;
  prepareTransaction(
    treasury: string,
    recipients: readonly { destination: string; lamports: bigint }[],
  ): Promise<PreparedTransaction>;
  sendSignedTransaction(transaction: Uint8Array): Promise<string>;
  getBlockHeight(): Promise<bigint>;
  getSignatureStatus(signature: string): Promise<{
    readonly confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
    readonly error: unknown;
    readonly slot: bigint;
  } | null>;
  getFinalizedTransfers(signature: string): Promise<{
    readonly error: unknown;
    readonly slot: bigint;
    readonly transfers: readonly ChainTransfer[];
  } | null>;
}

export interface PayoutSigner {
  readonly type: string;
  readonly publicKey: string;
  signTransaction(unsignedTransaction: Uint8Array): Promise<{
    readonly signedTransaction: Uint8Array;
    readonly signature: string;
  }>;
}

export class DisabledPayoutSigner implements PayoutSigner {
  readonly type = 'DISABLED';
  readonly publicKey = '';
  async signTransaction(): Promise<never> {
    throw new PayoutPlanError('PAYOUT_SIGNER_DISABLED', 'Payout signer is disabled.');
  }
}

export class LocalKeypairPayoutSigner implements PayoutSigner {
  readonly type = 'LOCAL_KEYPAIR';
  readonly publicKey: string;
  private constructor(private readonly keypair: Keypair) {
    this.publicKey = keypair.publicKey.toBase58();
  }
  static fromJsonSecret(secret: string) {
    let bytes: unknown;
    try {
      bytes = JSON.parse(secret);
    } catch {
      throw new PayoutPlanError('PAYOUT_SIGNER_SECRET_INVALID', 'Signer secret is not valid JSON.');
    }
    if (
      !Array.isArray(bytes) ||
      bytes.length !== 64 ||
      bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
    )
      throw new PayoutPlanError('PAYOUT_SIGNER_SECRET_INVALID', 'Signer secret must be 64 bytes.');
    return new LocalKeypairPayoutSigner(Keypair.fromSecretKey(Uint8Array.from(bytes as number[])));
  }
  async signTransaction(unsignedTransaction: Uint8Array) {
    const transaction = Transaction.from(unsignedTransaction);
    transaction.sign(this.keypair);
    if (!transaction.signature)
      throw new PayoutPlanError('PAYOUT_SIGNING_FAILED', 'Signer did not produce a signature.');
    return {
      signedTransaction: transaction.serialize(),
      signature: bs58.encode(transaction.signature),
    };
  }
}

const GENESIS_HASHES: Partial<Record<PayoutNetwork, string>> = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
};

export class SolanaPayoutRpc implements PayoutRpc {
  private readonly connection: Connection;
  constructor(endpoint: string, commitment: Commitment = 'confirmed') {
    this.connection = new Connection(endpoint, commitment);
  }
  async assertNetwork(network: PayoutNetwork) {
    const actual = await this.connection.getGenesisHash();
    const expected = GENESIS_HASHES[network];
    if (
      (expected && actual !== expected) ||
      (!expected && Object.values(GENESIS_HASHES).includes(actual))
    )
      throw new PayoutPlanError(
        'PAYOUT_NETWORK_MISMATCH',
        `RPC genesis hash does not match ${network}.`,
      );
  }
  async getBalance(address: string) {
    return BigInt(await this.connection.getBalance(new PublicKey(address), 'confirmed'));
  }
  async prepareTransaction(
    treasury: string,
    recipients: readonly { destination: string; lamports: bigint }[],
  ) {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({
      feePayer: new PublicKey(treasury),
      recentBlockhash: blockhash,
    });
    for (const recipient of recipients)
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(treasury),
          toPubkey: new PublicKey(recipient.destination),
          lamports: recipient.lamports,
        }),
      );
    const fee = await this.connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
    if (fee.value === null)
      throw new PayoutPlanError(
        'PAYOUT_FEE_UNAVAILABLE',
        'RPC could not estimate transaction fee.',
      );
    return {
      unsignedTransaction: transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
      feeLamports: BigInt(fee.value),
      recentBlockhash: blockhash,
      lastValidBlockHeight: BigInt(lastValidBlockHeight),
    };
  }
  async sendSignedTransaction(transaction: Uint8Array) {
    return this.connection.sendRawTransaction(transaction, { skipPreflight: false, maxRetries: 0 });
  }
  async getBlockHeight() {
    return BigInt(await this.connection.getBlockHeight('confirmed'));
  }
  async getSignatureStatus(signature: string) {
    const result = await this.connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = result.value[0];
    return status
      ? {
          confirmationStatus: status.confirmationStatus ?? null,
          error: status.err,
          slot: BigInt(status.slot),
        }
      : null;
  }
  async getFinalizedTransfers(signature: string) {
    const transaction = await this.connection.getParsedTransaction(signature, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });
    if (!transaction) return null;
    const transfers: ChainTransfer[] = [];
    for (const instruction of transaction.transaction.message.instructions) {
      if (
        'parsed' in instruction &&
        instruction.program === 'system' &&
        instruction.parsed.type === 'transfer'
      ) {
        const info = instruction.parsed.info as {
          source: string;
          destination: string;
          lamports: number;
        };
        transfers.push({
          source: info.source,
          destination: info.destination,
          lamports: BigInt(info.lamports),
        });
      }
    }
    return { error: transaction.meta?.err ?? null, slot: BigInt(transaction.slot), transfers };
  }
}

function assertPreparedTransactionMatchesIntent(
  unsignedTransaction: Uint8Array,
  treasury: string,
  recipients: readonly { destination: string; lamports: bigint }[],
) {
  let transaction: Transaction;
  try {
    transaction = Transaction.from(unsignedTransaction);
  } catch {
    throw new PayoutPlanError(
      'PAYOUT_TRANSACTION_INVALID',
      'Prepared transaction could not be decoded.',
    );
  }
  if (transaction.feePayer?.toBase58() !== treasury)
    throw new PayoutPlanError(
      'PAYOUT_TRANSACTION_INTENT_MISMATCH',
      'Prepared transaction fee payer does not match treasury.',
    );
  if (transaction.instructions.length !== recipients.length)
    throw new PayoutPlanError(
      'PAYOUT_TRANSACTION_INTENT_MISMATCH',
      'Prepared transaction instruction count does not match intent.',
    );
  for (const [index, instruction] of transaction.instructions.entries()) {
    let decoded: ReturnType<typeof SystemInstruction.decodeTransfer>;
    try {
      decoded = SystemInstruction.decodeTransfer(instruction);
    } catch {
      throw new PayoutPlanError(
        'PAYOUT_TRANSACTION_INTENT_MISMATCH',
        'Prepared transaction contains a non-transfer instruction.',
      );
    }
    const expected = recipients[index]!;
    if (
      decoded.fromPubkey.toBase58() !== treasury ||
      decoded.toPubkey.toBase58() !== expected.destination ||
      BigInt(decoded.lamports) !== expected.lamports
    )
      throw new PayoutPlanError(
        'PAYOUT_TRANSACTION_INTENT_MISMATCH',
        'Prepared transaction transfer does not match persisted intent.',
      );
  }
}

function snapshotHash(audit: NonNullable<Awaited<ReturnType<typeof getPayoutPlanAudit>>>) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: audit.id,
        competitionType: audit.competitionType,
        sourceId: audit.hourlyRoundId ?? audit.dailyCompetitionId,
        prizePoolLamports: audit.prizePoolLamports.toString(),
        curveVersion: audit.curveVersion,
        tiePolicyVersion: audit.tiePolicyVersion,
        allocations: audit.allocations.map((row) => [
          row.userId,
          row.walletAddress,
          row.allocatedLamports.toString(),
        ]),
      }),
    )
    .digest('hex');
}

export async function approvePayoutPlan(
  database: DatabaseService,
  input: { readonly planId: string; readonly approverIdentifier: string; readonly now: Date },
) {
  if (!input.approverIdentifier.trim())
    throw new PayoutPlanError('PAYOUT_APPROVER_REQUIRED', 'Approver identifier is required.');
  const priorApproval = (
    await database.pool.query('select * from payout_plan_approvals where payout_plan_id=$1', [
      input.planId,
    ])
  ).rows[0];
  if (priorApproval) return priorApproval;
  const validation = await validatePayoutPlan(database, input.planId);
  if (!validation.valid)
    throw new PayoutPlanError('PAYOUT_VALIDATION_FAILED', 'Payout plan no longer validates.');
  const audit = await getPayoutPlanAudit(database, input.planId);
  if (!audit) throw new PayoutPlanError('PAYOUT_PLAN_NOT_FOUND', 'Payout plan not found.');
  const hash = snapshotHash(audit);
  const approvalId = `approval:${input.planId}`;
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [input.planId]);
    const plan = (
      await client.query<{ state: string }>(
        'select state from payout_plans where id=$1 for update',
        [input.planId],
      )
    ).rows[0];
    if (!plan) throw new PayoutPlanError('PAYOUT_PLAN_NOT_FOUND', 'Payout plan not found.');
    if (plan.state === 'APPROVED') {
      const existing = (
        await client.query('select * from payout_plan_approvals where payout_plan_id=$1', [
          input.planId,
        ])
      ).rows[0];
      await client.query('commit');
      return existing;
    }
    if (plan.state !== 'VALIDATED')
      throw new PayoutPlanError(
        'PAYOUT_PLAN_NOT_VALIDATED',
        'Only validated plans can be approved.',
      );
    await client.query(
      `insert into payout_plan_approvals
       (id,payout_plan_id,approval_method,approver_identifier,plan_snapshot_hash,approved_at)
       values ($1,$2,'OPERATOR_CLI',$3,$4,$5)`,
      [approvalId, input.planId, input.approverIdentifier.trim(), hash, input.now],
    );
    await client.query(`update payout_plans set state='APPROVED',approved_at=$2 where id=$1`, [
      input.planId,
      input.now,
    ]);
    await client.query('commit');
    return { id: approvalId, payoutPlanId: input.planId, planSnapshotHash: hash };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function assertExecutionConfig(config: PayoutExecutionConfig, signer?: PayoutSigner) {
  try {
    new PublicKey(config.treasuryAddress);
  } catch {
    throw new PayoutPlanError('PAYOUT_TREASURY_INVALID', 'Treasury address is invalid.');
  }
  if (config.network === 'mainnet-beta' && !config.mainnetConfirmed)
    throw new PayoutPlanError(
      'PAYOUT_MAINNET_NOT_CONFIRMED',
      'Explicit mainnet confirmation is required.',
    );
  if (signer && signer.publicKey !== config.treasuryAddress)
    throw new PayoutPlanError(
      'PAYOUT_SIGNER_TREASURY_MISMATCH',
      'Signer does not control configured treasury.',
    );
}

export async function dryRunPayoutExecution(
  database: DatabaseService,
  input: {
    readonly planId: string;
    readonly config: PayoutExecutionConfig;
    readonly rpc: PayoutRpc;
  },
) {
  assertExecutionConfig(input.config);
  await input.rpc.assertNetwork(input.config.network);
  const audit = await getPayoutPlanAudit(database, input.planId);
  if (!audit) throw new PayoutPlanError('PAYOUT_PLAN_NOT_FOUND', 'Payout plan not found.');
  if (audit.state !== 'APPROVED')
    throw new PayoutPlanError('PAYOUT_PLAN_NOT_APPROVED', 'Payout plan must be approved.');
  const recipients = audit.allocations
    .filter((row) => row.allocatedLamports > 0n)
    .map((row) => ({
      allocationId: `${audit.id}:user:${row.userId}`,
      destination: row.walletAddress,
      lamports: row.allocatedLamports,
    }));
  for (const recipient of recipients) new PublicKey(recipient.destination);
  const intents = buildPayoutBatches({
    planId: audit.id,
    network: input.config.network,
    treasury: input.config.treasuryAddress,
    recipients,
    maxRecipientsPerBatch: input.config.maxRecipientsPerBatch,
  });
  const batches = [];
  for (const intent of intents) {
    const prepared = await input.rpc.prepareTransaction(
      input.config.treasuryAddress,
      intent.recipients,
    );
    assertPreparedTransactionMatchesIntent(
      prepared.unsignedTransaction,
      input.config.treasuryAddress,
      intent.recipients,
    );
    batches.push({ ...intent, ...prepared });
  }
  const totalPayoutLamports = batches.reduce((sum, batch) => sum + batch.totalLamports, 0n);
  const estimatedFeeLamports = batches.reduce((sum, batch) => sum + batch.feeLamports, 0n);
  const treasuryBalanceLamports = await input.rpc.getBalance(input.config.treasuryAddress);
  const requiredLamports = totalPayoutLamports + estimatedFeeLamports;
  return {
    planId: audit.id,
    network: input.config.network,
    treasuryAddress: input.config.treasuryAddress,
    batches,
    totalPayoutLamports,
    estimatedFeeLamports,
    requiredLamports,
    treasuryBalanceLamports,
    sufficientBalance: treasuryBalanceLamports >= requiredLamports,
  };
}

export async function executeApprovedPayoutPlan(
  database: DatabaseService,
  input: {
    readonly planId: string;
    readonly config: PayoutExecutionConfig;
    readonly rpc: PayoutRpc;
    readonly signer: PayoutSigner;
    readonly now: Date;
  },
) {
  if (!input.config.enabled)
    throw new PayoutPlanError('PAYOUT_EXECUTION_DISABLED', 'Live payout execution is disabled.');
  if (input.signer.type === 'DISABLED')
    throw new PayoutPlanError('PAYOUT_SIGNER_DISABLED', 'Payout signer is disabled.');
  assertExecutionConfig(input.config, input.signer);
  const existingExecution = (
    await database.pool.query<{ id: string; network: string; treasury_address: string }>(
      'select id,network,treasury_address from payout_executions where payout_plan_id=$1',
      [input.planId],
    )
  ).rows[0];
  if (existingExecution) {
    if (
      existingExecution.network !== input.config.network ||
      existingExecution.treasury_address !== input.config.treasuryAddress
    )
      throw new PayoutPlanError(
        'PAYOUT_EXECUTION_CONFIG_MISMATCH',
        'Persisted execution environment does not match current configuration.',
      );
    await input.rpc.assertNetwork(input.config.network);
    await signPreparedBatches(database, existingExecution.id, input.signer, input.now);
    await broadcastSignedBatches(database, existingExecution.id, input.rpc, input.now);
    return reconcilePayoutExecution(database, {
      executionId: existingExecution.id,
      rpc: input.rpc,
      now: input.now,
    });
  }
  const dryRun = await dryRunPayoutExecution(database, input);
  if (!dryRun.sufficientBalance)
    throw new PayoutPlanError(
      'PAYOUT_TREASURY_INSUFFICIENT',
      'Treasury cannot cover payouts and fees.',
    );
  const executionId = `execution:${input.planId}`;
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [executionId]);
    const existing = (
      await client.query<{ id: string }>(
        'select id from payout_executions where payout_plan_id=$1',
        [input.planId],
      )
    ).rows[0];
    if (!existing) {
      await client.query(
        `insert into payout_executions
         (id,payout_plan_id,network,treasury_address,signer_type,state,total_payout_lamports,estimated_fee_lamports,prepared_at)
         values ($1,$2,$3,$4,$5,'PREPARED',$6,$7,$8)`,
        [
          executionId,
          input.planId,
          input.config.network,
          input.config.treasuryAddress,
          input.signer.type,
          dryRun.totalPayoutLamports.toString(),
          dryRun.estimatedFeeLamports.toString(),
          input.now,
        ],
      );
      for (const batch of dryRun.batches) {
        const batchId = `${executionId}:batch:${batch.batchIndex}`;
        await client.query(
          `insert into payout_batches
           (id,payout_execution_id,batch_index,intent_version,intent_hash,state,recipient_count,total_lamports,fee_lamports,recent_blockhash,last_valid_block_height,unsigned_transaction_base64)
           values ($1,$2,$3,$4,$5,'PREPARED',$6,$7,$8,$9,$10,$11)`,
          [
            batchId,
            executionId,
            batch.batchIndex,
            PAYOUT_INTENT_VERSION,
            batch.intentHash,
            batch.recipients.length,
            batch.totalLamports.toString(),
            batch.feeLamports.toString(),
            batch.recentBlockhash,
            batch.lastValidBlockHeight.toString(),
            Buffer.from(batch.unsignedTransaction).toString('base64'),
          ],
        );
        for (const [ordinal, recipient] of batch.recipients.entries())
          await client.query(
            `insert into payout_batch_allocations
             (payout_batch_id,payout_allocation_id,ordinal,destination_address,lamports)
             values ($1,$2,$3,$4,$5)`,
            [
              batchId,
              recipient.allocationId,
              ordinal,
              recipient.destination,
              recipient.lamports.toString(),
            ],
          );
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  await signPreparedBatches(database, executionId, input.signer, input.now);
  await broadcastSignedBatches(database, executionId, input.rpc, input.now);
  return reconcilePayoutExecution(database, { executionId, rpc: input.rpc, now: input.now });
}

async function signPreparedBatches(
  database: DatabaseService,
  executionId: string,
  signer: PayoutSigner,
  now: Date,
) {
  const batches = await database.pool.query<{
    id: string;
    unsigned_transaction_base64: string;
    treasury_address: string;
  }>(
    `select b.id,b.unsigned_transaction_base64,e.treasury_address
     from payout_batches b join payout_executions e on e.id=b.payout_execution_id
     where b.payout_execution_id=$1 and b.state='PREPARED' order by b.batch_index`,
    [executionId],
  );
  for (const batch of batches.rows) {
    const unsigned = Buffer.from(batch.unsigned_transaction_base64, 'base64');
    const recipients = (
      await database.pool.query<{ destination_address: string; lamports: string }>(
        `select destination_address,lamports::text from payout_batch_allocations
         where payout_batch_id=$1 order by ordinal`,
        [batch.id],
      )
    ).rows.map((row) => ({
      destination: row.destination_address,
      lamports: BigInt(row.lamports),
    }));
    assertPreparedTransactionMatchesIntent(unsigned, batch.treasury_address, recipients);
    const signed = await signer.signTransaction(unsigned);
    await database.pool.query(
      `update payout_batches set state='SIGNED',signed_transaction_base64=$2,transaction_signature=$3,signed_at=$4,updated_at=$4 where id=$1 and state='PREPARED'`,
      [batch.id, Buffer.from(signed.signedTransaction).toString('base64'), signed.signature, now],
    );
  }
  await database.pool.query(
    `update payout_executions set state='SIGNED',signed_at=coalesce(signed_at,$2),updated_at=$2
     where id=$1 and state in ('PREPARED','FAILED_RETRYABLE')`,
    [executionId, now],
  );
  await database.pool.query(
    `update payout_plans set state='SIGNED',signed_at=coalesce(signed_at,$2)
     where id=(select payout_plan_id from payout_executions where id=$1)
       and state in ('APPROVED','FAILED_RETRYABLE')`,
    [executionId, now],
  );
}

async function broadcastSignedBatches(
  database: DatabaseService,
  executionId: string,
  rpc: PayoutRpc,
  now: Date,
) {
  const batches = await database.pool.query<{
    id: string;
    signed_transaction_base64: string;
    transaction_signature: string;
  }>(
    `select id,signed_transaction_base64,transaction_signature from payout_batches where payout_execution_id=$1 and state in ('SIGNED','FAILED_RETRYABLE') order by batch_index`,
    [executionId],
  );
  for (const batch of batches.rows) {
    const known = await rpc.getSignatureStatus(batch.transaction_signature);
    let outcome = known ? 'ALREADY_PROCESSED' : 'ACCEPTED';
    let detail: string | null = null;
    if (!known) {
      try {
        const returnedSignature = await rpc.sendSignedTransaction(
          Buffer.from(batch.signed_transaction_base64, 'base64'),
        );
        if (returnedSignature !== batch.transaction_signature)
          throw new Error('RPC returned a signature different from the signed transaction.');
      } catch (error) {
        outcome = 'UNCERTAIN';
        detail = error instanceof Error ? error.message.slice(0, 500) : 'Unknown RPC response';
      }
    }
    const attempt = await database.pool.query<{ count: string }>(
      'select count(*)::text count from payout_broadcast_attempts where payout_batch_id=$1',
      [batch.id],
    );
    const attemptNumber = Number(attempt.rows[0]!.count) + 1;
    await database.pool.query(
      `insert into payout_broadcast_attempts (id,payout_batch_id,attempt_number,transaction_signature,outcome,rpc_detail,attempted_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        `${batch.id}:attempt:${attemptNumber}`,
        batch.id,
        attemptNumber,
        batch.transaction_signature,
        outcome,
        detail,
        now,
      ],
    );
    await database.pool.query(
      `update payout_batches set state='BROADCAST',broadcast_at=coalesce(broadcast_at,$2),last_broadcast_at=$2,updated_at=$2 where id=$1`,
      [batch.id, now],
    );
  }
  await database.pool.query(
    `update payout_executions set state='BROADCAST',broadcast_at=coalesce(broadcast_at,$2),last_broadcast_at=$2,updated_at=$2 where id=$1 and state in ('SIGNED','FAILED_RETRYABLE')`,
    [executionId, now],
  );
  await database.pool.query(
    `update payout_plans set state='BROADCAST',broadcast_at=coalesce(broadcast_at,$2) where id=(select payout_plan_id from payout_executions where id=$1) and state='SIGNED'`,
    [executionId, now],
  );
}

export async function reconcilePayoutExecution(
  database: DatabaseService,
  input: { readonly executionId: string; readonly rpc: PayoutRpc; readonly now: Date },
) {
  const integrity = (
    await database.pool.query<{
      plan_total: string;
      execution_total: string;
      batch_total: string;
      expected_allocation_count: string;
      mapped_allocation_count: string;
    }>(
      `select p.total_allocated_lamports::text plan_total,
              e.total_payout_lamports::text execution_total,
              coalesce((select sum(b.total_lamports) from payout_batches b where b.payout_execution_id=e.id),0)::text batch_total,
              (select count(*) from payout_allocations a where a.payout_plan_id=p.id and a.allocated_lamports>0)::text expected_allocation_count,
              (select count(*) from payout_batch_allocations ba join payout_batches b on b.id=ba.payout_batch_id where b.payout_execution_id=e.id)::text mapped_allocation_count
       from payout_executions e join payout_plans p on p.id=e.payout_plan_id where e.id=$1`,
      [input.executionId],
    )
  ).rows[0];
  if (!integrity)
    throw new PayoutPlanError('PAYOUT_EXECUTION_NOT_FOUND', 'Payout execution not found.');
  if (
    integrity.plan_total !== integrity.execution_total ||
    integrity.plan_total !== integrity.batch_total ||
    integrity.expected_allocation_count !== integrity.mapped_allocation_count
  ) {
    await database.pool.query(
      `update payout_executions set state='RECONCILIATION_REQUIRED',failure_code='PERSISTED_INTENT_MISMATCH',
       failure_detail='Execution totals or allocation mapping do not match approved plan.',updated_at=$2 where id=$1`,
      [input.executionId, input.now],
    );
    await database.pool.query(
      `update payout_plans set state='RECONCILIATION_REQUIRED'
       where id=(select payout_plan_id from payout_executions where id=$1) and state <> 'VERIFIED'`,
      [input.executionId],
    );
    return {
      executionId: input.executionId,
      state: 'RECONCILIATION_REQUIRED',
      batchStates: [] as string[],
    };
  }
  const batches = await database.pool.query<{
    id: string;
    state: string;
    transaction_signature: string;
    last_valid_block_height: string;
  }>(
    `select id,state,transaction_signature,last_valid_block_height::text from payout_batches where payout_execution_id=$1 order by batch_index`,
    [input.executionId],
  );
  for (const batch of batches.rows) {
    if (batch.state === 'VERIFIED') continue;
    const status = await input.rpc.getSignatureStatus(batch.transaction_signature);
    if (status?.error) {
      await markBatchFailure(
        database,
        batch.id,
        'FAILED_FINAL',
        'ON_CHAIN_TRANSACTION_ERROR',
        JSON.stringify(status.error),
        input.now,
      );
      continue;
    }
    if (status?.confirmationStatus === 'finalized') {
      const chain = await input.rpc.getFinalizedTransfers(batch.transaction_signature);
      const expected = await database.pool.query<{ destination_address: string; lamports: string }>(
        `select destination_address,lamports::text from payout_batch_allocations where payout_batch_id=$1 order by ordinal`,
        [batch.id],
      );
      const execution = await database.pool.query<{ treasury_address: string }>(
        `select e.treasury_address from payout_executions e join payout_batches b on b.payout_execution_id=e.id where b.id=$1`,
        [batch.id],
      );
      const actual =
        chain?.transfers.filter((row) => row.source === execution.rows[0]!.treasury_address) ?? [];
      const matches =
        chain &&
        !chain.error &&
        JSON.stringify(actual.map((row) => [row.destination, row.lamports.toString()])) ===
          JSON.stringify(expected.rows.map((row) => [row.destination_address, row.lamports]));
      if (!matches) {
        await markBatchFailure(
          database,
          batch.id,
          'RECONCILIATION_REQUIRED',
          'ON_CHAIN_INTENT_MISMATCH',
          'Finalized transaction did not match persisted payout intent.',
          input.now,
        );
      } else {
        await database.pool.query(
          `update payout_batches set state='VERIFIED',verified_at=$2,confirmation_slot=$3,updated_at=$2,failure_code=null,failure_detail=null where id=$1`,
          [batch.id, input.now, chain.slot.toString()],
        );
      }
      continue;
    }
    const height = await input.rpc.getBlockHeight();
    if (!status && height > BigInt(batch.last_valid_block_height))
      await markBatchFailure(
        database,
        batch.id,
        'FAILED_RETRYABLE',
        'BLOCKHASH_EXPIRED',
        'Transaction was not found after its blockhash expired; a new signing cycle is required.',
        input.now,
      );
  }
  const states = (
    await database.pool.query<{ state: string }>(
      'select state from payout_batches where payout_execution_id=$1',
      [input.executionId],
    )
  ).rows.map((row) => row.state);
  let state = 'BROADCAST';
  if (states.every((value) => value === 'VERIFIED')) state = 'VERIFIED';
  else if (states.includes('RECONCILIATION_REQUIRED')) state = 'RECONCILIATION_REQUIRED';
  else if (states.includes('FAILED_FINAL')) state = 'FAILED_FINAL';
  else if (states.includes('FAILED_RETRYABLE')) state = 'FAILED_RETRYABLE';
  else if (states.includes('VERIFIED')) state = 'PARTIAL_VERIFIED';
  await database.pool.query(
    `update payout_executions set state=$2,verified_at=case when $2='VERIFIED' then $3 else verified_at end,updated_at=$3 where id=$1`,
    [input.executionId, state, input.now],
  );
  const planState = state === 'PARTIAL_VERIFIED' ? 'BROADCAST' : state;
  await database.pool.query(
    `update payout_plans set state=$2,verified_at=case when $2='VERIFIED' then $3 else verified_at end where id=(select payout_plan_id from payout_executions where id=$1) and state <> 'VERIFIED'`,
    [input.executionId, planState, input.now],
  );
  return { executionId: input.executionId, state, batchStates: states };
}

export async function retryPayoutExecution(
  database: DatabaseService,
  input: {
    readonly executionId: string;
    readonly config: PayoutExecutionConfig;
    readonly rpc: PayoutRpc;
    readonly signer: PayoutSigner;
    readonly now: Date;
  },
) {
  if (!input.config.enabled)
    throw new PayoutPlanError('PAYOUT_EXECUTION_DISABLED', 'Live payout execution is disabled.');
  assertExecutionConfig(input.config, input.signer);
  await input.rpc.assertNetwork(input.config.network);
  await reconcilePayoutExecution(database, input);
  const execution = (
    await database.pool.query<{ network: string; treasury_address: string }>(
      'select network,treasury_address from payout_executions where id=$1',
      [input.executionId],
    )
  ).rows[0];
  if (!execution)
    throw new PayoutPlanError('PAYOUT_EXECUTION_NOT_FOUND', 'Payout execution not found.');
  if (
    execution.network !== input.config.network ||
    execution.treasury_address !== input.config.treasuryAddress
  )
    throw new PayoutPlanError(
      'PAYOUT_EXECUTION_CONFIG_MISMATCH',
      'Persisted execution environment does not match current configuration.',
    );
  const batches = await database.pool.query<{
    id: string;
    state: string;
    transaction_signature: string;
  }>(
    `select id,state,transaction_signature from payout_batches
     where payout_execution_id=$1 and state='FAILED_RETRYABLE' order by batch_index`,
    [input.executionId],
  );
  for (const batch of batches.rows) {
    if (await input.rpc.getSignatureStatus(batch.transaction_signature))
      throw new PayoutPlanError(
        'PAYOUT_RETRY_RECONCILIATION_REQUIRED',
        'Original signature became visible; reconcile before retrying.',
      );
    const recipients = (
      await database.pool.query<{ destination_address: string; lamports: string }>(
        `select destination_address,lamports::text from payout_batch_allocations
         where payout_batch_id=$1 order by ordinal`,
        [batch.id],
      )
    ).rows.map((row) => ({
      destination: row.destination_address,
      lamports: BigInt(row.lamports),
    }));
    const prepared = await input.rpc.prepareTransaction(input.config.treasuryAddress, recipients);
    assertPreparedTransactionMatchesIntent(
      prepared.unsignedTransaction,
      input.config.treasuryAddress,
      recipients,
    );
    await database.pool.query(
      `update payout_batches set state='PREPARED',fee_lamports=$2,recent_blockhash=$3,
       last_valid_block_height=$4,unsigned_transaction_base64=$5,signed_transaction_base64=null,
       transaction_signature=null,signed_at=null,broadcast_at=null,failure_code=null,failure_detail=null,updated_at=$6
       where id=$1 and state='FAILED_RETRYABLE'`,
      [
        batch.id,
        prepared.feeLamports.toString(),
        prepared.recentBlockhash,
        prepared.lastValidBlockHeight.toString(),
        Buffer.from(prepared.unsignedTransaction).toString('base64'),
        input.now,
      ],
    );
  }
  await signPreparedBatches(database, input.executionId, input.signer, input.now);
  await broadcastSignedBatches(database, input.executionId, input.rpc, input.now);
  return reconcilePayoutExecution(database, input);
}

async function markBatchFailure(
  database: DatabaseService,
  id: string,
  state: string,
  code: string,
  detail: string,
  now: Date,
) {
  await database.pool.query(
    `update payout_batches set state=$2,failure_code=$3,failure_detail=$4,updated_at=$5 where id=$1`,
    [id, state, code, detail.slice(0, 1000), now],
  );
}
