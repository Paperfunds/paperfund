/** Stage 3B numerical evidence only. No production export, RPC, persistence or financial mutation. */
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { getTransferFeeConfig, unpackMint } from '@solana/spl-token';
import { cpAmmCoder, CpAmmIdl, derivePoolAuthority } from '@meteora-ag/cp-amm-sdk';
import { createMarketStateEvidence, ExecutionEngineError, } from '@paperfund/execution';
import { METEORA_DAMM_V2_PROGRAM } from '../solana-routes.js';
import { WRAPPED_SOL_MINT } from '../pump-fun.js';
import { createSequentialSimulation, transitionSequentialRoute, } from './sequential-route.js';
export class ExternalEvidenceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
function reject(code, message) {
    throw new ExternalEvidenceError(code, message);
}
function decodeBase58(text) {
    if (typeof text !== 'string' || !text.length)
        return reject('INCOMPLETE_EVIDENCE', 'Missing instruction bytes.');
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let value = 0n;
    for (const c of text) {
        const digit = alphabet.indexOf(c);
        if (digit < 0)
            return reject('INCOMPLETE_EVIDENCE', 'Invalid instruction encoding.');
        value = value * 58n + BigInt(digit);
    }
    const bytes = [];
    while (value) {
        bytes.push(Number(value & 255n));
        value >>= 8n;
    }
    const zeros = text.length - text.replace(/^1+/, '').length;
    return Buffer.concat([Buffer.alloc(zeros), Buffer.from(bytes.reverse())]);
}
function canonical(v) {
    if (typeof v === 'bigint')
        return { $integer: v.toString() };
    if (Array.isArray(v))
        return v.map(canonical);
    if (v && typeof v === 'object')
        return Object.fromEntries(Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, x]) => [k, canonical(x)]));
    return v;
}
export const externalEvidenceHash = (v) => createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');
const unsigned = (v) => {
    const text = typeof v === 'string' ? v : v && typeof v === 'object' && 'toString' in v ? v.toString() : '';
    if (!/^\d+$/.test(text))
        return reject('CONTRADICTORY_EVIDENCE', 'Missing exact unsigned integer.');
    const n = BigInt(text);
    if (n > (1n << 128n) - 1n)
        return reject('UNSUPPORTED_EVIDENCE', 'Integer exceeds supported bounds.');
    return n;
};
function camel(v) {
    if (Array.isArray(v))
        return v.map(camel);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype)
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [
            k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()),
            camel(x),
        ]));
    return v;
}
function guard(work) {
    try {
        return work();
    }
    catch (e) {
        if (e instanceof ExternalEvidenceError)
            throw e;
        if (e instanceof ExecutionEngineError)
            return reject('UNSUPPORTED_EVIDENCE', 'Protocol cannot establish this numerical transition: ' + e.code);
        return reject('INCOMPLETE_EVIDENCE', 'Receipt or dependency account data cannot be decoded reliably.');
    }
}
function dependency(state) {
    const hops = state.normalizedState['hops'], accounts = state.normalizedState['accounts'];
    if (!Array.isArray(hops) || hops.length !== 1 || hops[0].program !== METEORA_DAMM_V2_PROGRAM)
        return reject('UNSUPPORTED_EVIDENCE', 'Only a single recorded DAMM pool is supported; Pump multi-hop remains unsupported.');
    const hop = hops[0];
    for (const address of [
        hop.pool,
        hop.vaultA,
        hop.vaultB,
        hop.mintA,
        hop.mintB,
        'SysvarC1ock11111111111111111111111111111111',
    ])
        if (!accounts?.[address]?.base64)
            return reject('INCOMPLETE_EVIDENCE', 'Missing dependency account: ' + address);
    if (accounts[hop.pool].owner !== METEORA_DAMM_V2_PROGRAM || hop.mintB !== WRAPPED_SOL_MINT)
        return reject('UNSUPPORTED_EVIDENCE', 'Pool owner/quote asset is unsupported.');
    const pool = camel(cpAmmCoder.accounts.decode('Pool', Buffer.from(accounts[hop.pool].base64, 'base64')));
    if (pool.layoutVersion !== 1 ||
        pool.collectFeeMode !== 2 ||
        pool.tokenAMint.toBase58() !== hop.mintA ||
        pool.tokenBMint.toBase58() !== hop.mintB ||
        pool.tokenAVault.toBase58() !== hop.vaultA ||
        pool.tokenBVault.toBase58() !== hop.vaultB)
        return reject('UNSUPPORTED_EVIDENCE', 'Only layout-v1 compounding pools with exact identity binding are supported.');
    // Without an observed event-bank epoch, differing fee schedules cannot be selected reliably.
    for (const mint of [hop.mintA, hop.mintB]) {
        const a = accounts[mint], info = unpackMint(new PublicKey(mint), {
            data: Buffer.from(a.base64, 'base64'),
            owner: new PublicKey(a.owner),
            lamports: 0,
            executable: false,
            rentEpoch: 0,
        }, new PublicKey(a.owner));
        const fee = getTransferFeeConfig(info);
        if (fee &&
            (fee.olderTransferFee.transferFeeBasisPoints !==
                fee.newerTransferFee.transferFeeBasisPoints ||
                fee.olderTransferFee.maximumFee !== fee.newerTransferFee.maximumFee))
            return reject('UNSUPPORTED_EVIDENCE', 'Transfer-fee epoch change needs additional bank evidence.');
    }
    return { hop, accounts, pool };
}
export function compareExternalLocations(a, b) {
    return a.slot !== b.slot
        ? a.slot < b.slot
            ? -1
            : 1
        : a.transactionIndex - b.transactionIndex ||
            a.outerIndex - b.outerIndex ||
            a.innerIndex - b.innerIndex;
}
export function packetIdentity(p) {
    return `${p.block.blockhash}:${p.receipt.transaction.signatures[0]}`;
}
export function decodeMeteoraSwap(state, packet) {
    return guard(() => decode(state, packet));
}
function decode(state, packet) {
    const { hop, accounts } = dependency(state), tx = packet?.receipt, block = packet?.block;
    if (!tx?.meta ||
        !tx.transaction?.message ||
        !block?.blockhash ||
        !block.previousBlockhash ||
        !Array.isArray(block.signatures))
        return reject('INCOMPLETE_EVIDENCE', 'Missing transaction receipt or finalized block ordering.');
    if (![0, 1, 'legacy'].includes(tx.version))
        return reject('UNSUPPORTED_EVIDENCE', 'Unknown transaction version.');
    if (!Number.isSafeInteger(tx.slot) ||
        !Number.isSafeInteger(packet.transactionIndex) ||
        packet.transactionIndex < 0 ||
        block.commitment !== 'finalized' ||
        block.slot !== tx.slot ||
        block.parentSlot >= block.slot ||
        block.signatures[packet.transactionIndex] !== tx.transaction.signatures[0])
        return reject('CONTRADICTORY_EVIDENCE', 'Receipt does not match finalized block position.');
    if (!Object.hasOwn(tx.meta, 'err') || tx.meta.err === undefined)
        return reject('INCOMPLETE_EVIDENCE', 'Transaction outcome is missing.');
    const keys = [
        ...tx.transaction.message.accountKeys,
        ...tx.meta.loadedAddresses.writable,
        ...tx.meta.loadedAddresses.readonly,
    ];
    if (tx.meta.err !== null)
        return {
            outcome: 'FAILED',
            stateChanging: false,
            rawHash: externalEvidenceHash(packet),
            packetIdentity: packetIdentity(packet),
        };
    if (!Array.isArray(tx.meta.innerInstructions))
        return reject('INCOMPLETE_EVIDENCE', 'Missing CPI trace.');
    const authority = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], new PublicKey(METEORA_DAMM_V2_PROGRAM))[0].toBase58();
    const swaps = [];
    const emitted = [];
    for (const group of tx.meta.innerInstructions) {
        if (!Number.isSafeInteger(group.index) || !tx.transaction.message.instructions[group.index])
            return reject('INCOMPLETE_EVIDENCE', 'Invalid outer instruction location.');
        for (const [index, ix] of group.instructions.entries()) {
            if (!Number.isSafeInteger(ix.programIdIndex) ||
                !keys[ix.programIdIndex] ||
                ix.accounts.some((i) => !Number.isSafeInteger(i) || !keys[i]))
                return reject('INCOMPLETE_EVIDENCE', 'Missing loaded account keys.');
            if (keys[ix.programIdIndex] !== METEORA_DAMM_V2_PROGRAM)
                continue;
            const raw = decodeBase58(ix.data);
            if (raw.subarray(0, 8).toString('hex') === 'e445a52e51cb9a1d') {
                if (ix.accounts.length !== 1 || keys[ix.accounts[0]] !== authority)
                    return reject('CONTRADICTORY_EVIDENCE', 'Invalid event-CPI authority.');
                const event = cpAmmCoder.events.decode(raw.subarray(8).toString('base64'));
                if (!event || event.name !== 'EvtSwap2')
                    return reject('UNSUPPORTED_EVIDENCE', 'Unknown DAMM event-CPI payload.');
                emitted.push({
                    ix,
                    outer: group.index,
                    inner: index,
                    data: event.data,
                });
            }
            else {
                const decoded = cpAmmCoder.instruction.decode(raw);
                if (!decoded || decoded.name !== 'swap2')
                    return reject('UNSUPPORTED_EVIDENCE', 'Unknown swap/configuration/liquidity instruction.');
                swaps.push({
                    ix,
                    outer: group.index,
                    inner: index,
                    params: decoded.data._params,
                });
            }
        }
    }
    // This initial verifier requires one unambiguous pool operation per receipt.
    if (swaps.length !== 1 || emitted.length !== 1)
        return reject('INCOMPLETE_EVIDENCE', 'Missing or ambiguous swap/event pair.');
    const swap = swaps[0], event = emitted[0], e = event.data;
    if (swap.outer !== event.outer ||
        event.inner <= swap.inner ||
        swap.ix.stackHeight !== 2 ||
        event.ix.stackHeight !== 3)
        return reject('CONTRADICTORY_EVIDENCE', 'Ambiguous CPI ancestry/order.');
    const address = (i) => keys[swap.ix.accounts[i]];
    if (address(0) !== derivePoolAuthority().toBase58() ||
        address(1) !== hop.pool ||
        address(4) !== hop.vaultA ||
        address(5) !== hop.vaultB ||
        address(6) !== hop.mintA ||
        address(7) !== hop.mintB ||
        address(9) !== accounts[hop.mintA].owner ||
        address(10) !== accounts[hop.mintB].owner ||
        address(12) !== authority ||
        address(13) !== METEORA_DAMM_V2_PROGRAM ||
        String(e['pool']) !== hop.pool)
        return reject('CONTRADICTORY_EVIDENCE', 'Pool, mint, vault or program identity differs.');
    const params = e['params'], result = e['swap_result'];
    if (!params ||
        !result ||
        ![0, 1].includes(params['swap_mode']) ||
        e['collect_fee_mode'] !== 2 ||
        e['has_referral'] !== false ||
        unsigned(result['referral_fee']) !== 0n ||
        ![0, 1].includes(e['trade_direction']) ||
        unsigned(result['amount_left']) !== 0n)
        return reject('UNSUPPORTED_EVIDENCE', 'ExactOut, partial capacity, referrals or fee-mode transitions are unsupported.');
    for (const field of ['amount_0', 'amount_1', 'swap_mode'])
        if (String(params[field]) !== String(swap.params[field]))
            return reject('CONTRADICTORY_EVIDENCE', 'Instruction parameters disagree with the event.');
    const aToB = e['trade_direction'] === 0, input = unsigned(e['included_transfer_fee_amount_in']), grossOutput = unsigned(e['included_transfer_fee_amount_out']), output = unsigned(e['excluded_transfer_fee_amount_out']);
    if (input !== unsigned(params['amount_0']) ||
        output > grossOutput ||
        unsigned(result['included_fee_input_amount']) > input ||
        unsigned(result['output_amount']) !== grossOutput)
        return reject('CONTRADICTORY_EVIDENCE', 'Contradictory input/output or transfer fees.');
    const inputVault = aToB ? hop.vaultA : hop.vaultB, outputVault = aToB ? hop.vaultB : hop.vaultA, inputMint = aToB ? hop.mintA : hop.mintB, outputMint = aToB ? hop.mintB : hop.mintA;
    const transfers = tx.meta.innerInstructions
        .find((g) => g.index === swap.outer)
        .instructions.slice(swap.inner + 1, event.inner);
    if (transfers.length !== 2)
        return reject('UNSUPPORTED_EVIDENCE', 'Unknown intermediate token/configuration operations.');
    for (const [index, ix] of transfers.entries()) {
        const raw = decodeBase58(ix.data), mint = index === 0 ? inputMint : outputMint;
        if (ix.stackHeight !== 3 ||
            keys[ix.programIdIndex] !== accounts[mint].owner ||
            raw.length !== 10 ||
            raw[0] !== 12 ||
            keys[ix.accounts[1]] !== mint ||
            keys[ix.accounts[index === 0 ? 0 : 2]] !== address(index === 0 ? 2 : 3) ||
            keys[ix.accounts[3]] !== address(index === 0 ? 8 : 0) ||
            raw[9] !== Buffer.from(accounts[mint].base64, 'base64')[44] ||
            keys[ix.accounts[index === 0 ? 2 : 0]] !== (index === 0 ? inputVault : outputVault) ||
            raw.readBigUInt64LE(1) !== (index === 0 ? input : grossOutput))
            return reject('UNSUPPORTED_EVIDENCE', 'Token transfer/hook/withheld/configuration semantics are not established.');
    }
    const dependencies = new Set([hop.mintA, hop.mintB, hop.vaultA, hop.vaultB]);
    for (const ix of [
        ...tx.transaction.message.instructions,
        ...tx.meta.innerInstructions.flatMap((g) => g.instructions),
    ]) {
        if (![accounts[hop.mintA].owner, accounts[hop.mintB].owner].includes(keys[ix.programIdIndex] ?? '') ||
            !ix.accounts.some((i) => dependencies.has(keys[i])))
            continue;
        const raw = decodeBase58(ix.data);
        // Explicitly recognized SPL operations in the recorded wrappers: a read-only size query,
        // and initialization of a user's token account. Neither may initialize a pool vault.
        if (raw[0] === 21 &&
            (raw.length - 1) % 2 === 0 &&
            ix.accounts.length === 1 &&
            [hop.mintA, hop.mintB].includes(keys[ix.accounts[0]]))
            continue;
        if (raw[0] === 18 &&
            raw.length === 33 &&
            ix.accounts.length === 2 &&
            [hop.mintA, hop.mintB].includes(keys[ix.accounts[1]]) &&
            ![hop.vaultA, hop.vaultB].includes(keys[ix.accounts[0]]))
            continue;
        if (raw.length !== 10 || raw[0] !== 12)
            return reject('UNSUPPORTED_EVIDENCE', 'Additional mint/withheld/configuration operation is unsupported.');
        if (ix.accounts.some((i) => [hop.vaultA, hop.vaultB].includes(keys[i])) &&
            !transfers.includes(ix))
            return reject('CONTRADICTORY_EVIDENCE', 'Additional transfers touch the same vault.');
    }
    const balance = (list, vault, mint) => {
        const found = list.filter((b) => keys[b.accountIndex] === vault);
        if (found.length !== 1 ||
            found[0].mint !== mint ||
            found[0].owner !== derivePoolAuthority().toBase58() ||
            found[0].uiTokenAmount.decimals !== Buffer.from(accounts[mint].base64, 'base64')[44] ||
            found[0].programId !== accounts[mint].owner)
            return reject('INCOMPLETE_EVIDENCE', 'Missing or contradictory vault token balances.');
        return unsigned(found[0].uiTokenAmount.amount);
    };
    const netInput = unsigned(result['included_fee_input_amount']);
    if (balance(tx.meta.postTokenBalances, inputVault, inputMint) -
        balance(tx.meta.preTokenBalances, inputVault, inputMint) !==
        netInput ||
        balance(tx.meta.preTokenBalances, outputVault, outputMint) -
            balance(tx.meta.postTokenBalances, outputVault, outputMint) !==
            grossOutput)
        return reject('CONTRADICTORY_EVIDENCE', 'Whole-transaction vault movements do not isolate this swap.');
    const location = {
        slot: BigInt(tx.slot),
        transactionIndex: packet.transactionIndex,
        outerIndex: event.outer,
        innerIndex: event.inner,
    };
    const normalized = {
        outcome: 'SUCCESS',
        stateChanging: true,
        pool: hop.pool,
        inputMint,
        outputMint,
        aToB,
        input,
        output,
        grossOutput,
        transferFee: input - netInput,
        time: unsigned(e['current_timestamp']),
        location,
        packetIdentity: packetIdentity(packet),
        program: {
            address: METEORA_DAMM_V2_PROGRAM,
            codec: 'cp-amm-sdk-1.5.1',
            idlHash: externalEvidenceHash(CpAmmIdl),
            historicalBinaryVersion: null,
        },
        claimingFee: unsigned(result['claiming_fee']),
        compoundingFee: unsigned(result['compounding_fee']),
        protocolFee: unsigned(result['protocol_fee']),
        reserveA: unsigned(e['reserve_a_amount']),
        reserveB: unsigned(e['reserve_b_amount']),
        sqrtPrice: unsigned(result['next_sqrt_price']),
        minimumOutput: unsigned(params['amount_1']),
        rawHash: externalEvidenceHash(packet),
        rawEventBytes: event.ix.data,
    };
    return { ...normalized, eventHash: externalEvidenceHash(normalized) };
}
/** Declared receipt manifests detect omissions in this bounded input, not all chain/account writes. */
export function verifyNeutralReplay(initial, packets, expectedPacketIds, purpose) {
    return guard(() => {
        if (purpose !== 'POOL_LOCAL_NUMERICAL')
            return reject('RECONCILIATION_UNPROVEN', 'Finalized snapshot binding and dependency-write completeness are not established.');
        if (!packets.length || packets.length > 16 || packets.length !== expectedPacketIds.length)
            return reject('EVIDENCE_GAP', 'Bounded receipt manifest is incomplete.');
        const seen = new Set();
        let previous;
        const scope = { accountId: 'NO_FINANCIAL_ACCOUNT', roundId: 'OFFLINE_EXTERNAL_PROOF' };
        let simulation = createSequentialSimulation(scope, [initial]);
        const transitions = [];
        const decodedPackets = packets.map((packet) => decodeMeteoraSwap(initial, packet));
        for (const [index, decoded] of decodedPackets.entries()) {
            if (decoded.outcome !== 'SUCCESS')
                return reject('UNSUPPORTED_EVIDENCE', 'Failed transactions cannot advance pool state.');
            if (seen.has(decoded.packetIdentity))
                return reject('DUPLICATE_EVENT', 'Duplicate receipt/event.');
            seen.add(decoded.packetIdentity);
            if (decoded.packetIdentity !== expectedPacketIds[index])
                return reject('EVIDENCE_GAP', 'Receipt ordering/identity differs from declared manifest.');
            if (previous && compareExternalLocations(previous, decoded.location) >= 0)
                return reject('ORDERING_ERROR', 'External events must follow finalized block/CPI order.');
            previous = decoded.location;
        }
        for (const decoded of decodedPackets) {
            if (decoded.outcome !== 'SUCCESS')
                return reject('UNSUPPORTED_EVIDENCE', 'Failed receipts cannot be replayed.');
            const result = applyDecoded(initial, simulation, decoded);
            simulation = result.next;
            const p = dependency({
                ...initial,
                normalizedState: { ...initial.normalizedState, accounts: simulation.accounts },
            }).pool;
            if (result.quote.output !== decoded.output ||
                BigInt(p.tokenAAmount.toString()) !== decoded.reserveA ||
                BigInt(p.tokenBAmount.toString()) !== decoded.reserveB ||
                BigInt(p.sqrtPrice.toString()) !== decoded.sqrtPrice)
                return reject('CONTRADICTORY_EVIDENCE', 'Neutral output/reserves/price do not reproduce the receipt.');
            const fees = result.quote.fees;
            for (const [category, amount] of [
                ['LP_CLAIM_FEE', decoded.claimingFee],
                ['LP_COMPOUND_FEE', decoded.compoundingFee],
                ['PROTOCOL_FEE', decoded.protocolFee],
            ])
                if (fees
                    .filter((f) => f.category === category)
                    .reduce((sum, f) => sum + f.amount.amount, 0n) !== amount)
                    return reject('CONTRADICTORY_EVIDENCE', 'Neutral fee split does not reproduce the receipt.');
            transitions.push({
                eventHash: decoded.eventHash,
                beforeFingerprint: result.evidence.beforeFingerprint,
                afterFingerprint: result.evidence.afterFingerprint,
                output: result.quote.output,
            });
        }
        return {
            model: 'EXTERNAL_SWAP_NUMERICAL_V1',
            sourceFingerprint: createMarketStateEvidence(initial).fingerprint,
            simulation,
            transitions,
            evidenceHash: externalEvidenceHash(transitions),
            eligibility: 'NUMERICAL_ONLY',
            financialUsePermitted: false,
            limitations: [
                'Initial confirmed snapshot is not finalized-blockhash bound',
                'Dependency-account write completeness is unproven',
                'Historical binary and enclosing-route slippage are unverified',
            ],
        };
    });
}
/** Counterfactual pool-local arithmetic; not an assertion that the real enclosing transaction succeeds. */
export function applyMeteoraNumericalEvent(initial, simulation, packet) {
    const event = decodeMeteoraSwap(initial, packet);
    if (event.outcome !== 'SUCCESS')
        return reject('UNSUPPORTED_EVIDENCE', 'Failed receipts do not advance state.');
    return applyDecoded(initial, simulation, event);
}
function applyDecoded(initial, simulation, event) {
    return guard(() => {
        const original = dependency(initial);
        const current = dependency({
            ...initial,
            normalizedState: { ...initial.normalizedState, accounts: simulation.accounts },
        });
        const immutablePool = (p) => ({
            liquidity: p.liquidity,
            sqrtMinPrice: p.sqrtMinPrice,
            sqrtMaxPrice: p.sqrtMaxPrice,
            activationPoint: p.activationPoint,
            activationType: p.activationType,
            poolStatus: p.poolStatus,
            feeVersion: p.feeVersion,
            baseFee: p.poolFees.baseFee,
            compoundingFeeBps: p.poolFees.compoundingFeeBps,
            protocolFeePercent: p.poolFees.protocolFeePercent,
            dynamic: {
                initialized: p.poolFees.dynamicFee.initialized,
                variableFeeControl: p.poolFees.dynamicFee.variableFeeControl,
                maxVolatilityAccumulator: p.poolFees.dynamicFee.maxVolatilityAccumulator,
                binStep: p.poolFees.dynamicFee.binStep,
                binStepU128: p.poolFees.dynamicFee.binStepU128,
                filterPeriod: p.poolFees.dynamicFee.filterPeriod,
                decayPeriod: p.poolFees.dynamicFee.decayPeriod,
                reductionFactor: p.poolFees.dynamicFee.reductionFactor,
            },
        });
        if (externalEvidenceHash(immutablePool(original.pool)) !==
            externalEvidenceHash(immutablePool(current.pool)) ||
            [original.hop.mintA, original.hop.mintB].some((m) => externalEvidenceHash(original.accounts[m]) !== externalEvidenceHash(current.accounts[m])))
            return reject('UNSUPPORTED_EVIDENCE', 'Pool configuration/liquidity or mint/withheld state changed without supported evidence.');
        const copy = structuredClone(simulation), clockAddress = 'SysvarC1ock11111111111111111111111111111111';
        const route = copy.routes[initial.identity.marketId];
        if (!route)
            return reject('INCOMPLETE_EVIDENCE', 'Missing sandbox route.');
        const raw = Buffer.from(copy.accounts[clockAddress].base64, 'base64');
        if (event.location.slot < route.chainSlot || event.time < BigInt(raw.readBigInt64LE(32)))
            return reject('ORDERING_ERROR', 'Event clock/slot regressed.');
        raw.writeBigUInt64LE(event.location.slot, 0);
        raw.writeBigInt64LE(event.time, 32);
        const accounts = {
            ...copy.accounts,
            [clockAddress]: { ...copy.accounts[clockAddress], base64: raw.toString('base64') },
        };
        const prepared = {
            ...copy,
            accounts,
            routes: {
                ...copy.routes,
                [initial.identity.marketId]: { ...route, chainSlot: event.location.slot },
            },
        };
        const result = transitionSequentialRoute(prepared, prepared.scope, initial.identity.marketId, event.input, !event.aToB);
        if (result.quote.output < event.minimumOutput)
            return reject('UNSUPPORTED_EVIDENCE', 'Counterfactual swap fails its observed leaf slippage limit.');
        if (BigInt(result.quote.details[0]['inputTransferFee']) !== event.transferFee)
            return reject('CONTRADICTORY_EVIDENCE', 'Transfer-fee evidence disagrees with the snapshot.');
        return {
            ...result,
            eligibility: 'NUMERICAL_ONLY',
            financialUsePermitted: false,
            enclosingTransactionReexecuted: false,
        };
    });
}
//# sourceMappingURL=external-event-evidence.js.map