import {
  withPayoutTreasury,
  reservePayoutTreasury,
  assertPayoutTreasuryEffect,
  validatePayoutTreasuryReadOnly,
  assertTreasuryEnvironment,
  assertTreasuryPreparedFees,
  recordTreasurySettlement,
} from './payout-treasury.js';
import {
  withPayoutAuthorization,
  authorizedApprover,
  assertPayoutStep,
  invokeAuthorizedPayoutEffect,
  assertPayoutEnvironment,
  persistApprovalAuthorization,
  assertApprovalAuthorization,
  type OperatorRequest,
} from './payout-security.js';
import {
  withPayoutOperation,
  payoutPlanForExecution,
  recordPayoutEvent,
  requireSerializedExecution,
} from './payout-coordination.js';
import {
  APPROVAL_SNAPSHOT_VERSION,
  approvalSnapshotHash,
  captureApprovalSnapshot,
  assertApprovalBinding,
  assertExecutionBinding,
  assertObservedExecutionBinding,
  transactionDatabase,
  verifiedPayoutReplay,
} from './payout-approval.js';

import { buildPayoutBatches, PAYOUT_INTENT_VERSION, type PayoutNetwork } from '@paperfund/core';
import {
  Connection,
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
  readonly mainnetMaxPlanLamports?: bigint;
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
    readonly feeLamports?: bigint;
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
    const balance = await this.connection.getBalance(new PublicKey(address), 'confirmed');
    if (!Number.isSafeInteger(balance) || balance < 0)
      throw new PayoutPlanError(
        'PAYOUT_RPC_AMOUNT_UNSAFE',
        'Exact treasury amount is unavailable.',
      );
    return BigInt(balance);
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
    if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value < 0)
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
    return this.connection.sendRawTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 0,
    });
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
        if (!Number.isSafeInteger(info.lamports) || info.lamports < 0)
          throw new PayoutPlanError(
            'PAYOUT_RPC_AMOUNT_UNSAFE',
            'Exact finalized transfer amount is unavailable.',
          );
        transfers.push({
          source: info.source,
          destination: info.destination,
          lamports: BigInt(info.lamports),
        });
      }
    }
    return {
      error: transaction.meta?.err ?? null,
      slot: BigInt(transaction.slot),
      transfers,
      ...(Number.isSafeInteger(transaction.meta?.fee)
        ? { feeLamports: BigInt(transaction.meta!.fee) }
        : {}),
    };
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

async function approvePayoutPlanAuthorized(
  database: DatabaseService,
  input: {
    readonly planId: string;
    readonly approverIdentifier: string;
    readonly authority?: OperatorRequest;
    readonly now: Date;
  },
) {
  if (!input.approverIdentifier.trim())
    throw new PayoutPlanError('PAYOUT_APPROVER_REQUIRED', 'Approver identifier is required.');
  const client = await database.pool.connect();
  try {
    await client.query('begin isolation level repeatable read');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [input.planId]);
    const scoped = transactionDatabase(database, client);
    const plan = (
      await client.query<{ state: string }>(
        'select state from payout_plans where id=$1 for update',
        [input.planId],
      )
    ).rows[0];
    if (!plan) throw new PayoutPlanError('PAYOUT_PLAN_NOT_FOUND', 'Payout plan not found.');
    const prior = (
      await client.query('select * from payout_plan_approvals where payout_plan_id=$1', [
        input.planId,
      ])
    ).rows[0];
    if (prior) {
      authorizedApprover(String(prior.plan_snapshot_hash));
      if (!(await verifiedPayoutReplay(database, input.planId)))
        await reservePayoutTreasury(scoped, input.planId, String(prior.plan_snapshot_hash));
      await client.query('commit');
      if (await verifiedPayoutReplay(database, input.planId)) return prior;
      await assertApprovalBinding(database, input.planId);
      return prior;
    }
    if (plan.state !== 'VALIDATED')
      throw new PayoutPlanError(
        'PAYOUT_PLAN_NOT_VALIDATED',
        'Only validated plans can be approved.',
      );
    const validation = await validatePayoutPlan(scoped, input.planId);
    if (!validation.valid)
      throw new PayoutPlanError('PAYOUT_VALIDATION_FAILED', 'Payout plan no longer validates.');
    const audit = await getPayoutPlanAudit(scoped, input.planId);
    if (!audit) throw new PayoutPlanError('PAYOUT_PLAN_NOT_FOUND', 'Payout plan not found.');
    const snapshot = await captureApprovalSnapshot(scoped, audit);
    const hash = approvalSnapshotHash(snapshot);
    await reservePayoutTreasury(scoped, input.planId, hash);
    const approvalId = 'approval:' + input.planId;
    await client.query(
      `insert into payout_plan_approvals
       (id,payout_plan_id,approval_method,approver_identifier,plan_snapshot_hash,approved_at)
       values ($1,$2,'OPERATOR_CLI',$3,$4,$5)`,
      [approvalId, input.planId, authorizedApprover(hash), hash, input.now],
    );
    await client.query(
      'insert into payout_approval_snapshots (approval_id,snapshot_version,snapshot) values ($1,$2,$3)',
      [
        approvalId,
        APPROVAL_SNAPSHOT_VERSION,
        JSON.stringify(snapshot, (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
      ],
    );
    await client.query("update payout_plans set state='APPROVED',approved_at=$2 where id=$1", [
      input.planId,
      input.now,
    ]);
    await persistApprovalAuthorization(client, approvalId);
    await client.query('commit');
    return {
      id: approvalId,
      payoutPlanId: input.planId,
      planSnapshotHash: hash,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function guardExecution(database: DatabaseService, executionId: string) {
  await requireSerializedExecution(database, executionId);
  const binding = await assertExecutionBinding(database, executionId);
  assertPayoutEnvironment(binding.execution.network, binding.execution.treasury_address);
  await assertApprovalAuthorization(database, binding.execution.payout_plan_id);
  assertTreasuryEnvironment(binding.execution.network, binding.execution.treasury_address);
  await assertPayoutTreasuryEffect();
  const batches = await validatePersistedTransactions(database, executionId, binding);
  for (const batch of batches) await assertTreasuryPreparedFees(BigInt(batch.fee_lamports));
}

// Pure recorded-evidence validation: remains usable while STOP/funding/permissions forbid effects.
export async function validatePayoutObservation(database: DatabaseService, executionId: string) {
  await requireSerializedExecution(database, executionId);
  const binding = await assertObservedExecutionBinding(database, executionId);
  await validatePersistedTransactions(database, executionId, binding);
  return binding;
}

async function validatePersistedTransactions(
  database: DatabaseService,
  executionId: string,
  binding: Awaited<ReturnType<typeof assertExecutionBinding>>,
) {
  const missing = (
    await database.pool.query<{ id: string }>(
      `select b.id from payout_batches b left join payout_signed_transactions h on h.payout_batch_id=b.id
     where b.payout_execution_id=$1 and ((b.signed_transaction_base64 is null and h.payout_batch_id is not null) or
     (b.signed_transaction_base64 is not null and (h.payout_batch_id is null or h.transaction_signature<>b.transaction_signature or h.intent_hash<>b.intent_hash
      or h.signed_transaction_base64<>b.signed_transaction_base64 or h.unsigned_transaction_base64<>b.unsigned_transaction_base64
      or h.recent_blockhash<>b.recent_blockhash or h.last_valid_block_height<>b.last_valid_block_height)))`,
      [executionId],
    )
  ).rows;
  if (missing.length)
    throw new PayoutPlanError(
      'PAYOUT_SIGNING_EVIDENCE_MISMATCH',
      'Persisted signed evidence is missing or contradictory.',
    );
  const batches = (
    await database.pool.query<{
      id: string;
      state: string;
      unsigned_transaction_base64: string;
      recent_blockhash: string;
      signed_transaction_base64: string | null;
      transaction_signature: string | null;
      fee_lamports: string;
    }>('select * from payout_batches where payout_execution_id=$1 order by batch_index', [
      executionId,
    ])
  ).rows;
  for (const batch of batches) {
    const recipients = (
      await database.pool.query<{
        destination_address: string;
        lamports: string;
      }>(
        'select destination_address,lamports::text from payout_batch_allocations where payout_batch_id=$1 order by ordinal',
        [batch.id],
      )
    ).rows.map((row) => ({
      destination: row.destination_address,
      lamports: BigInt(row.lamports),
    }));
    const unsigned = Buffer.from(batch.unsigned_transaction_base64, 'base64');
    assertPreparedTransactionMatchesIntent(
      unsigned,
      binding.execution.treasury_address,
      recipients,
    );
    if (Transaction.from(unsigned).recentBlockhash !== batch.recent_blockhash)
      throw new PayoutPlanError(
        'PAYOUT_TRANSACTION_INTENT_MISMATCH',
        'Recorded blockhash differs from the persisted transaction.',
      );
    if (
      batch.state !== 'PREPARED' &&
      (!batch.signed_transaction_base64 || !batch.transaction_signature)
    )
      throw new PayoutPlanError(
        'PAYOUT_TRANSACTION_INTENT_MISMATCH',
        'Payment state lacks persisted signed evidence.',
      );
    if (
      batch.state === 'PREPARED' &&
      (batch.signed_transaction_base64 || batch.transaction_signature)
    )
      throw new PayoutPlanError(
        'PAYOUT_TRANSACTION_INTENT_MISMATCH',
        'Prepared state contradicts signed evidence.',
      );
    if (batch.signed_transaction_base64) {
      const signed = Buffer.from(batch.signed_transaction_base64, 'base64');
      assertSignedTransactionMatches(unsigned, signed, batch.transaction_signature ?? '');
    } else if (batch.transaction_signature)
      throw new PayoutPlanError(
        'PAYOUT_TRANSACTION_INTENT_MISMATCH',
        'Signature exists without signed bytes.',
      );
  }
  return batches;
}

function assertSignedTransactionMatches(
  unsigned: Uint8Array,
  signed: Uint8Array,
  signature: string,
) {
  try {
    const transaction = Transaction.from(signed);
    if (
      !transaction.serializeMessage().equals(Transaction.from(unsigned).serializeMessage()) ||
      !transaction.signature ||
      bs58.encode(transaction.signature) !== signature
    )
      throw new Error();
  } catch {
    throw new PayoutPlanError(
      'PAYOUT_TRANSACTION_INTENT_MISMATCH',
      'Signed bytes or signature differ from the approved prepared transaction.',
    );
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

async function dryRunPayoutExecutionLocked(
  database: DatabaseService,
  input: {
    readonly planId: string;
    readonly config: PayoutExecutionConfig;
    readonly rpc: PayoutRpc;
  },
) {
  assertExecutionConfig(input.config);
  assertTreasuryEnvironment(input.config.network, input.config.treasuryAddress);
  await validatePayoutTreasuryReadOnly();
  await input.rpc.assertNetwork(input.config.network);
  const audit = await getPayoutPlanAudit(database, input.planId);
  if (!audit) throw new PayoutPlanError('PAYOUT_PLAN_NOT_FOUND', 'Payout plan not found.');
  if (audit.state !== 'APPROVED')
    throw new PayoutPlanError('PAYOUT_PLAN_NOT_APPROVED', 'Payout plan must be approved.');
  const binding = await assertApprovalBinding(database, input.planId);
  const recipients = binding.allocations
    .filter((row) => BigInt(row.lamports) > 0n)
    .map((row) => ({
      allocationId: row.allocationId,
      destination: row.destination,
      lamports: BigInt(row.lamports),
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
    await assertApprovalBinding(database, input.planId);
    await validatePayoutTreasuryReadOnly();
    const prepared = await input.rpc.prepareTransaction(
      input.config.treasuryAddress,
      intent.recipients,
    );
    await assertTreasuryPreparedFees(prepared.feeLamports);
    await validatePayoutTreasuryReadOnly();
    assertPreparedTransactionMatchesIntent(
      prepared.unsignedTransaction,
      input.config.treasuryAddress,
      intent.recipients,
    );
    await assertApprovalBinding(database, input.planId);
    batches.push({ ...intent, ...prepared });
  }
  const totalPayoutLamports = batches.reduce((sum, batch) => sum + batch.totalLamports, 0n);
  if (
    input.config.network === 'mainnet-beta' &&
    input.config.mainnetMaxPlanLamports !== undefined &&
    totalPayoutLamports > input.config.mainnetMaxPlanLamports
  )
    throw new PayoutPlanError(
      'PAYOUT_MAINNET_CAP_EXCEEDED',
      'Approved plan exceeds the configured mainnet payout safety cap.',
    );
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

async function executeApprovedPayoutPlanLocked(
  database: DatabaseService,
  input: {
    readonly planId: string;
    readonly config: PayoutExecutionConfig;
    readonly rpc: PayoutRpc;
    readonly signer: PayoutSigner;
    readonly authority?: OperatorRequest;
    readonly now: Date;
  },
) {
  if (!input.config.enabled)
    throw new PayoutPlanError('PAYOUT_EXECUTION_DISABLED', 'Live payout execution is disabled.');
  if (input.signer.type === 'DISABLED')
    throw new PayoutPlanError('PAYOUT_SIGNER_DISABLED', 'Payout signer is disabled.');
  assertExecutionConfig(input.config, input.signer);
  const verified = await verifiedPayoutReplay(database, input.planId);
  if (verified) return verified;
  const existingExecution = (
    await database.pool.query<{
      id: string;
      network: string;
      treasury_address: string;
    }>('select id,network,treasury_address from payout_executions where payout_plan_id=$1', [
      input.planId,
    ])
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
    return retryPayoutExecutionLocked(database, {
      ...input,
      executionId: existingExecution.id,
    });
  }
  await assertApprovalBinding(database, input.planId);
  await assertApprovalAuthorization(database, input.planId);
  const dryRun = await dryRunPayoutExecutionLocked(database, input);
  await assertApprovalBinding(database, input.planId);
  if (!dryRun.sufficientBalance)
    throw new PayoutPlanError(
      'PAYOUT_TREASURY_INSUFFICIENT',
      'Treasury cannot cover payouts and fees.',
    );
  const executionId = `execution:${input.planId}`;
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await assertPayoutTreasuryEffect();
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
         (id,payout_plan_id,network,treasury_address,signer_type,state,total_payout_lamports,estimated_fee_lamports,prepared_at,safety_version)
         values ($1,$2,$3,$4,$5,'PREPARED',$6,$7,$8,'payout-serialized-v1')`,
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
  return reconcilePayoutExecutionLocked(database, {
    executionId,
    rpc: input.rpc,
    now: input.now,
  });
}

async function signPreparedBatches(
  database: DatabaseService,
  executionId: string,
  signer: PayoutSigner,
  now: Date,
) {
  await guardExecution(database, executionId);
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
      await database.pool.query<{
        destination_address: string;
        lamports: string;
      }>(
        `select destination_address,lamports::text from payout_batch_allocations
         where payout_batch_id=$1 order by ordinal`,
        [batch.id],
      )
    ).rows.map((row) => ({
      destination: row.destination_address,
      lamports: BigInt(row.lamports),
    }));
    assertPreparedTransactionMatchesIntent(unsigned, batch.treasury_address, recipients);
    await guardExecution(database, executionId);
    const signed = await invokeAuthorizedPayoutEffect('SIGN', batch.id, () =>
      signer.signTransaction(unsigned),
    );
    assertSignedTransactionMatches(unsigned, signed.signedTransaction, signed.signature);
    await guardExecution(database, executionId);
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

interface ObservedBatch {
  id: string;
  state: string;
  transaction_signature: string | null;
  last_valid_block_height: string;
  signed_transaction_base64: string | null;
}

async function observeBatch(
  database: DatabaseService,
  batch: ObservedBatch,
  state: string,
  now: Date,
  code: string | null = null,
  slot: bigint | null = null,
) {
  const result = await database.pool.query(
    `update payout_batches set state=$2,failure_code=$3,failure_detail=$3,updated_at=$4,
      verified_at=case when $2='VERIFIED' then $4 else verified_at end,
      confirmation_slot=case when $2='VERIFIED' then $5 else confirmation_slot end
     where id=$1 and state=$6 and transaction_signature is not distinct from $7 and state<>'VERIFIED'`,
    [
      batch.id,
      state,
      code,
      now,
      slot?.toString() ?? null,
      batch.state,
      batch.transaction_signature,
    ],
  );
  if (result.rowCount !== 1)
    throw new PayoutPlanError(
      'PAYOUT_OBSERVATION_CONFLICT',
      'Expected batch transition was not applied.',
    );
  return result;
}

async function holdBatch(
  database: DatabaseService,
  executionId: string,
  batch: ObservedBatch,
  now: Date,
  reason: string,
) {
  await observeBatch(database, batch, 'RECONCILIATION_REQUIRED', now, reason);
  await recordPayoutEvent(database, {
    executionId,
    batchId: batch.id,
    ...(batch.transaction_signature ? { signature: batch.transaction_signature } : {}),
    event: 'REVIEW_HOLD',
    detail: { reason },
  });
}

async function broadcastSignedBatches(
  database: DatabaseService,
  executionId: string,
  rpc: PayoutRpc,
  now: Date,
) {
  await guardExecution(database, executionId);
  const batches = (
    await database.pool.query<ObservedBatch>(
      `select * from payout_batches where payout_execution_id=$1 and state in ('SIGNED','BROADCAST','FAILED_RETRYABLE') order by batch_index`,
      [executionId],
    )
  ).rows;
  for (const batch of batches) {
    await guardExecution(database, executionId);
    let known: Awaited<ReturnType<PayoutRpc['getSignatureStatus']>>;
    try {
      known = await rpc.getSignatureStatus(batch.transaction_signature!);
    } catch {
      await holdBatch(database, executionId, batch, now, 'SIGNATURE_OBSERVATION_UNAVAILABLE');
      break;
    }
    await guardExecution(database, executionId);
    if (known) continue; // confirmation is evidence to reconcile, never reason to re-sign.
    let height: bigint;
    try {
      height = await rpc.getBlockHeight();
    } catch {
      await holdBatch(database, executionId, batch, now, 'EXPIRY_OBSERVATION_UNAVAILABLE');
      break;
    }
    if (height > BigInt(batch.last_valid_block_height)) {
      await holdBatch(database, executionId, batch, now, 'EXPIRED_SIGNATURE_HISTORY_UNCERTAIN');
      break;
    }
    await guardExecution(database, executionId);
    // This immutable attempt is committed BEFORE the external send. Outcome at this instant is uncertain.
    const attempt = (
      await database.pool.query<{ attempt_number: number }>(
        `insert into payout_broadcast_attempts (id,payout_batch_id,attempt_number,transaction_signature,outcome,rpc_detail,attempted_at)
       select $1||':attempt:'||n,$1,n,$2,'UNCERTAIN','DURABLE_BEFORE_RPC_SEND',$3
       from (select coalesce(max(attempt_number),0)+1 n from payout_broadcast_attempts where payout_batch_id=$1) next
       returning attempt_number`,
        [batch.id, batch.transaction_signature, now],
      )
    ).rows[0]!;
    await recordPayoutEvent(database, {
      executionId,
      batchId: batch.id,
      signature: batch.transaction_signature!,
      event: 'SEND_STARTED',
      detail: { attemptNumber: attempt.attempt_number },
    });
    const signedBytes = Buffer.from(batch.signed_transaction_base64!, 'base64');
    const accepted = await invokeAuthorizedPayoutEffect('BROADCAST', batch.id, () => {
      // Only RPC failures are uncertain sends; authorization rejection propagates unchanged.
      try {
        return rpc.sendSignedTransaction(signedBytes).then(
          (returned) => returned === batch.transaction_signature,
          () => false,
        );
      } catch {
        // A provider can also throw synchronously after accepting the artifact.
        return Promise.resolve(false);
      }
    });
    await recordPayoutEvent(database, {
      executionId,
      batchId: batch.id,
      signature: batch.transaction_signature!,
      event: accepted ? 'SEND_RETURNED' : 'SEND_UNCERTAIN',
      detail: { attemptNumber: attempt.attempt_number },
    });
    if (!accepted) {
      await holdBatch(database, executionId, batch, now, 'RPC_SEND_UNCERTAIN');
      break;
    }
    await observeBatch(database, batch, 'BROADCAST', now);
  }
}

async function aggregateExecution(
  database: DatabaseService,
  executionId: string,
  now: Date,
  transactionOpen = false,
) {
  const rows = (
    await database.pool.query<{ state: string }>(
      'select state from payout_batches where payout_execution_id=$1 order by batch_index',
      [executionId],
    )
  ).rows;
  const states = rows.map((row) => row.state);
  let state = 'BROADCAST';
  if (!states.length) state = 'RECONCILIATION_REQUIRED';
  else if (states.every((value) => value === 'VERIFIED')) state = 'VERIFIED';
  else if (states.includes('RECONCILIATION_REQUIRED')) state = 'RECONCILIATION_REQUIRED';
  else if (states.includes('FAILED_FINAL')) state = 'FAILED_FINAL';
  else if (states.every((value) => value === 'PREPARED')) state = 'PREPARED';
  else if (states.every((value) => value === 'SIGNED')) state = 'SIGNED';
  else if (states.includes('FAILED_RETRYABLE')) state = 'FAILED_RETRYABLE';
  const client = await database.pool.connect();
  try {
    if (!transactionOpen) await client.query('begin');
    const row = (
      await client.query<{ state: string; payout_plan_id: string }>(
        'select state,payout_plan_id from payout_executions where id=$1 for update',
        [executionId],
      )
    ).rows[0];
    if (!row)
      throw new PayoutPlanError('PAYOUT_EXECUTION_NOT_FOUND', 'Payout execution not found.');
    if (row.state !== 'VERIFIED' && row.state !== state)
      await client.query(
        `update payout_executions set state=$2,verified_at=case when $2='VERIFIED' then $3 else verified_at end,updated_at=$3 where id=$1 and state=$4 and state<>'VERIFIED'`,
        [executionId, state, now, row.state],
      );
    const plan = (
      await client.query<{ state: string }>(
        'select state from payout_plans where id=$1 for update',
        [row.payout_plan_id],
      )
    ).rows[0]!;
    let current = plan.state;
    const desired = state === 'PREPARED' ? 'APPROVED' : state;
    // Recover interrupted application state progress using only already-persisted signed/chain evidence.
    if (current === 'APPROVED' && ['SIGNED', 'BROADCAST', 'VERIFIED'].includes(desired)) {
      await client.query(
        `update payout_plans set state='SIGNED',signed_at=coalesce(signed_at,$2) where id=$1 and state='APPROVED'`,
        [row.payout_plan_id, now],
      );
      current = 'SIGNED';
    }
    if (current === 'SIGNED' && desired === 'VERIFIED') {
      await client.query(
        `update payout_plans set state='BROADCAST',broadcast_at=coalesce(broadcast_at,$2) where id=$1 and state='SIGNED'`,
        [row.payout_plan_id, now],
      );
      current = 'BROADCAST';
    }
    if (current !== desired && current !== 'VERIFIED')
      await client.query(
        `update payout_plans set state=$2,verified_at=case when $2='VERIFIED' then $3 else verified_at end where id=$1 and state=$4 and state<>'VERIFIED'`,
        [row.payout_plan_id, desired, now, current],
      );
    if (!transactionOpen) await client.query('commit');
  } catch (error) {
    if (!transactionOpen) await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return { executionId, state, batchStates: states };
}

async function reconcilePayoutExecutionLocked(
  database: DatabaseService,
  input: { readonly executionId: string; readonly rpc: PayoutRpc; readonly now: Date },
) {
  const planId = await payoutPlanForExecution(database, input.executionId);
  const verified = await verifiedPayoutReplay(database, planId);
  if (verified) return verified;
  await database.pool.query('begin');
  try {
    await database.pool.query('select id from payout_executions where id=$1 for update', [
      input.executionId,
    ]);
    await database.pool.query(
      'select id from payout_batches where payout_execution_id=$1 order by batch_index for update',
      [input.executionId],
    );
    const binding = await validatePayoutObservation(database, input.executionId);
    await input.rpc.assertNetwork(binding.execution.network);
    const integrity = (
      await database.pool.query<{
        plan_total: string;
        execution_total: string;
        batch_total: string;
        expected_count: string;
        mapped_count: string;
      }>(
        `select p.total_allocated_lamports::text plan_total,e.total_payout_lamports::text execution_total,
      (select coalesce(sum(total_lamports),0)::text from payout_batches where payout_execution_id=e.id) batch_total,
      (select count(*)::text from payout_allocations where payout_plan_id=p.id and allocated_lamports>0) expected_count,
      (select count(*)::text from payout_batch_allocations ba join payout_batches b on b.id=ba.payout_batch_id where b.payout_execution_id=e.id) mapped_count
     from payout_executions e join payout_plans p on p.id=e.payout_plan_id where e.id=$1`,
        [input.executionId],
      )
    ).rows[0]!;
    if (
      integrity.plan_total !== integrity.execution_total ||
      integrity.plan_total !== integrity.batch_total ||
      integrity.expected_count !== integrity.mapped_count
    )
      throw new PayoutPlanError(
        'PAYOUT_APPROVED_INTENT_MISMATCH',
        'Persisted payout mapping requires independent review.',
      );
    const batches = (
      await database.pool.query<ObservedBatch>(
        'select * from payout_batches where payout_execution_id=$1 order by batch_index',
        [input.executionId],
      )
    ).rows;
    for (const batch of batches) {
      if (
        batch.state === 'VERIFIED' ||
        batch.state === 'FAILED_FINAL' ||
        !batch.transaction_signature
      )
        continue;
      let status: Awaited<ReturnType<PayoutRpc['getSignatureStatus']>>;
      try {
        status = await input.rpc.getSignatureStatus(batch.transaction_signature);
      } catch {
        await holdBatch(
          database,
          input.executionId,
          batch,
          input.now,
          'SIGNATURE_OBSERVATION_UNAVAILABLE',
        );
        continue;
      }
      if (status?.confirmationStatus === 'finalized') {
        if (status.error) {
          const failed = await input.rpc.getFinalizedTransfers(batch.transaction_signature);
          if (!failed || failed.slot !== status.slot || !failed.error)
            throw new PayoutPlanError(
              'PAYOUT_TREASURY_SETTLEMENT_REVIEW_REQUIRED',
              'Finalized failure fee evidence is required.',
            );
          await recordTreasurySettlement(
            database,
            batch.id,
            batch.transaction_signature,
            0n,
            failed.feeLamports,
            failed.slot,
          );
          await observeBatch(
            database,
            batch,
            'FAILED_FINAL',
            input.now,
            'FINALIZED_TRANSACTION_ERROR',
          );
          continue;
        }
        let chain: Awaited<ReturnType<PayoutRpc['getFinalizedTransfers']>>;
        try {
          chain = await input.rpc.getFinalizedTransfers(batch.transaction_signature);
        } catch {
          await holdBatch(
            database,
            input.executionId,
            batch,
            input.now,
            'FINALIZED_TRANSACTION_UNAVAILABLE',
          );
          continue;
        }
        const expected = (
          await database.pool.query<{ destination_address: string; lamports: string }>(
            'select destination_address,lamports::text from payout_batch_allocations where payout_batch_id=$1 order by ordinal',
            [batch.id],
          )
        ).rows;
        const treasury = (
          await database.pool.query<{ treasury_address: string }>(
            'select treasury_address from payout_executions where id=$1',
            [input.executionId],
          )
        ).rows[0]!.treasury_address;
        const actual = chain?.transfers.filter((row) => row.source === treasury) ?? [];
        const matches =
          chain &&
          !chain.error &&
          JSON.stringify(actual.map((row) => [row.destination, row.lamports.toString()])) ===
            JSON.stringify(expected.map((row) => [row.destination_address, row.lamports]));
        if (!matches)
          await holdBatch(
            database,
            input.executionId,
            batch,
            input.now,
            'ON_CHAIN_INTENT_MISMATCH',
          );
        else {
          if (chain!.slot !== status.slot)
            throw new PayoutPlanError(
              'PAYOUT_TREASURY_SETTLEMENT_REVIEW_REQUIRED',
              'Finalized slots disagree.',
            );
          await recordTreasurySettlement(
            database,
            batch.id,
            batch.transaction_signature,
            expected.reduce((n, r) => n + BigInt(r.lamports), 0n),
            chain!.feeLamports,
            chain!.slot,
          );
          await observeBatch(database, batch, 'VERIFIED', input.now, null, chain!.slot);
        }
        continue;
      }
      if (!status) {
        let height: bigint;
        try {
          height = await input.rpc.getBlockHeight();
        } catch {
          await holdBatch(
            database,
            input.executionId,
            batch,
            input.now,
            'EXPIRY_OBSERVATION_UNAVAILABLE',
          );
          continue;
        }
        if (height > BigInt(batch.last_valid_block_height))
          await holdBatch(
            database,
            input.executionId,
            batch,
            input.now,
            'EXPIRED_SIGNATURE_HISTORY_UNCERTAIN',
          );
      }
    }
    const result = await aggregateExecution(database, input.executionId, input.now, true);
    await database.pool.query('commit');
    return result;
  } catch (error) {
    await database.pool.query('rollback');
    throw error;
  }
}

async function retryPayoutExecutionLocked(
  database: DatabaseService,
  input: {
    readonly executionId: string;
    readonly config: PayoutExecutionConfig;
    readonly rpc: PayoutRpc;
    readonly signer: PayoutSigner;
    readonly authority?: OperatorRequest;
    readonly now: Date;
  },
) {
  if (!input.config.enabled)
    throw new PayoutPlanError('PAYOUT_EXECUTION_DISABLED', 'Live payout execution is disabled.');
  assertExecutionConfig(input.config, input.signer);
  const planId = await payoutPlanForExecution(database, input.executionId);
  const verified = await verifiedPayoutReplay(database, planId);
  if (verified) return verified;
  await assertPayoutStep('RETRY');
  await input.rpc.assertNetwork(input.config.network);
  await requireSerializedExecution(database, input.executionId);
  const row = (
    await database.pool.query<{ state: string; network: string; treasury_address: string }>(
      'select * from payout_executions where id=$1',
      [input.executionId],
    )
  ).rows[0]!;
  if (row.network !== input.config.network || row.treasury_address !== input.config.treasuryAddress)
    throw new PayoutPlanError(
      'PAYOUT_EXECUTION_CONFIG_MISMATCH',
      'Execution environment differs from its persisted authority.',
    );
  // A held execution can only observe its existing signatures, never prepare or sign a replacement.
  if (row.state === 'RECONCILIATION_REQUIRED')
    return reconcilePayoutExecutionLocked(database, input);
  // Existing signature observation remains available even when funding/caps now forbid new effects.
  const result = await reconcilePayoutExecutionLocked(database, input);
  if (['VERIFIED', 'RECONCILIATION_REQUIRED', 'FAILED_FINAL'].includes(result.state)) return result;
  if (
    input.config.network === 'mainnet-beta' &&
    input.config.mainnetMaxPlanLamports !== undefined
  ) {
    const total = (
      await database.pool.query<{ total_payout_lamports: string }>(
        'select total_payout_lamports::text from payout_executions where id=$1',
        [input.executionId],
      )
    ).rows[0]!;
    if (BigInt(total.total_payout_lamports) > input.config.mainnetMaxPlanLamports)
      throw new PayoutPlanError(
        'PAYOUT_MAINNET_CAP_EXCEEDED',
        'Persisted plan exceeds the configured mainnet payout safety cap.',
      );
  }
  await guardExecution(database, input.executionId);
  await signPreparedBatches(database, input.executionId, input.signer, input.now);
  await broadcastSignedBatches(database, input.executionId, input.rpc, input.now);
  return reconcilePayoutExecutionLocked(database, input);
}

export async function executeApprovedPayoutPlan(
  database: DatabaseService,
  input: Parameters<typeof executeApprovedPayoutPlanLocked>[1],
) {
  const verified = await verifiedPayoutReplay(database, input.planId);
  if (verified) return verified;
  return withPayoutAuthorization(database, input.authority, 'EXECUTE', input.planId, () => {
    assertPayoutEnvironment(input.config.network, input.config.treasuryAddress);
    return withPayoutTreasury(database, input.planId, (treasury) =>
      withPayoutOperation(treasury, input.planId, (scoped) =>
        executeApprovedPayoutPlanLocked(scoped, input),
      ),
    );
  });
}
export async function retryPayoutExecution(
  database: DatabaseService,
  input: Parameters<typeof retryPayoutExecutionLocked>[1],
) {
  const planId = await payoutPlanForExecution(database, input.executionId);
  const verified = await verifiedPayoutReplay(database, planId);
  if (verified) return verified;
  return withPayoutAuthorization(database, input.authority, 'RETRY', planId, () => {
    assertPayoutEnvironment(input.config.network, input.config.treasuryAddress);
    return withPayoutTreasury(database, planId, (treasury) =>
      withPayoutOperation(treasury, planId, (scoped) => retryPayoutExecutionLocked(scoped, input)),
    );
  });
}
export async function reconcilePayoutExecution(
  database: DatabaseService,
  input: Parameters<typeof reconcilePayoutExecutionLocked>[1],
) {
  const planId = await payoutPlanForExecution(database, input.executionId);
  const verified = await verifiedPayoutReplay(database, planId);
  if (verified) return verified;
  return withPayoutTreasury(database, planId, (treasury) =>
    withPayoutOperation(treasury, planId, (scoped) =>
      reconcilePayoutExecutionLocked(scoped, input),
    ),
  );
}

export async function approvePayoutPlan(
  database: DatabaseService,
  input: Parameters<typeof approvePayoutPlanAuthorized>[1],
) {
  return withPayoutAuthorization(database, input.authority, 'APPROVE', input.planId, () =>
    withPayoutTreasury(database, input.planId, (scoped) =>
      approvePayoutPlanAuthorized(scoped, input),
    ),
  );
}

export async function dryRunPayoutExecution(
  database: DatabaseService,
  input: Parameters<typeof dryRunPayoutExecutionLocked>[1],
) {
  return withPayoutTreasury(database, input.planId, (treasury) =>
    withPayoutOperation(treasury, input.planId, (scoped) =>
      dryRunPayoutExecutionLocked(scoped, input),
    ),
  );
}
