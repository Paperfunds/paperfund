import { safeErrorMessage } from '@paperfund/core';
import { advisoryReadContext, ADVISORY_CLOCK_ACCOUNT, advisoryClockTime, } from './rpc-read-context.js';
import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, } from '@solana/addresses';
import { identifier, paperSolBaseUnits, tokenBaseUnits, } from '@paperfund/core';
import { createMarketStateEvidence, ExecutionEngineError, } from '@paperfund/execution';
import { maximumConstantProductSell } from './sell-capacity.js';
export const PUMP_FUN_PROTOCOL_ID = identifier('PUMP_FUN', 'ProtocolId');
export const PUMP_FUN_ADAPTER_VERSION = 'pump-bonding-curve-v1';
export const PUMP_FUN_NORMALIZATION_VERSION = 'pump-bonding-curve-state-v1';
export const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_FEE_PROGRAM_ID = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ZERO_PUBLIC_KEY = '11111111111111111111111111111111';
const ONE_BILLION_TOKEN_BASE_UNITS = 1000000000000000n;
const BPS_DENOMINATOR = 10000n;
const BONDING_CURVE_DISCRIMINATOR = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);
const GLOBAL_DISCRIMINATOR = Buffer.from([167, 232, 232, 177, 200, 108, 114, 127]);
const FEE_CONFIG_DISCRIMINATOR = Buffer.from([143, 52, 146, 187, 219, 123, 76, 155]);
const addressDecoder = getAddressDecoder();
const addressEncoder = getAddressEncoder();
function requireBytes(data, offset, length, label) {
    if (offset < 0 || length < 0 || offset + length > data.length) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', `${label} account data is truncated.`);
    }
}
function assertDiscriminator(data, expected, label) {
    requireBytes(data, 0, expected.length, label);
    if (!data.subarray(0, expected.length).equals(expected)) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', `${label} discriminator is invalid.`);
    }
}
function readU64(data, offset, label) {
    requireBytes(data, offset, 8, label);
    return data.readBigUInt64LE(offset);
}
function readU128(data, offset, label) {
    requireBytes(data, offset, 16, label);
    return data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n);
}
function readPublicKey(data, offset, label) {
    requireBytes(data, offset, 32, label);
    return addressDecoder.decode(data.subarray(offset, offset + 32));
}
export function decodePumpBondingCurve(data) {
    if (data.length < 49) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Bonding curve account is truncated.');
    }
    assertDiscriminator(data, BONDING_CURVE_DISCRIMINATOR, 'Bonding curve');
    const optionalPublicKey = (offset) => data.length >= offset + 32 ? readPublicKey(data, offset, 'Bonding curve') : ZERO_PUBLIC_KEY;
    const optionalBool = (offset) => data.length > offset ? data[offset] !== 0 : false;
    const optionalU64 = (offset) => data.length >= offset + 8 ? readU64(data, offset, 'Bonding curve') : 0n;
    return {
        virtualTokenReserves: readU64(data, 8, 'Bonding curve'),
        virtualSolReserves: readU64(data, 16, 'Bonding curve'),
        realTokenReserves: readU64(data, 24, 'Bonding curve'),
        realSolReserves: readU64(data, 32, 'Bonding curve'),
        tokenTotalSupply: readU64(data, 40, 'Bonding curve'),
        complete: data[48] !== 0,
        creator: optionalPublicKey(49),
        isMayhemMode: optionalBool(81),
        isCashbackCoin: optionalBool(82),
        quoteMint: optionalPublicKey(83),
        creatorFeeBps: optionalU64(115),
        isHolderReward: optionalBool(124),
    };
}
export function decodePumpGlobal(data) {
    if (data.length < 162) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump global account is truncated.');
    }
    assertDiscriminator(data, GLOBAL_DISCRIMINATOR, 'Pump global');
    return {
        feeBasisPoints: readU64(data, 105, 'Pump global'),
        creatorFeeBasisPoints: readU64(data, 154, 'Pump global'),
        creatorFeeConfigurable: data.length > 1045 ? data[1045] !== 0 : false,
    };
}
export function decodePumpFeeConfig(data) {
    if (data.length < 69) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump fee config account is truncated.');
    }
    assertDiscriminator(data, FEE_CONFIG_DISCRIMINATOR, 'Pump fee config');
    const count = data.readUInt32LE(65);
    if (count === 0 || count > 50) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump fee tier count is invalid.');
    }
    const tiers = [];
    let offset = 69;
    for (let index = 0; index < count; index += 1) {
        requireBytes(data, offset, 40, 'Pump fee config');
        tiers.push({
            marketCapLamportsThreshold: readU128(data, offset, 'Pump fee config'),
            protocolFeeBps: readU64(data, offset + 24, 'Pump fee config'),
            creatorFeeBps: readU64(data, offset + 32, 'Pump fee config'),
        });
        offset += 40;
    }
    for (let index = 1; index < tiers.length; index += 1) {
        if (tiers[index].marketCapLamportsThreshold < tiers[index - 1].marketCapLamportsThreshold) {
            throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump fee tiers are not sorted.');
        }
    }
    return { feeTiers: tiers, accountLength: data.length };
}
export async function pumpBondingCurveAddress(tokenMint) {
    try {
        return (await getProgramDerivedAddress({
            programAddress: address(PUMP_PROGRAM_ID),
            seeds: [Buffer.from('bonding-curve'), addressEncoder.encode(address(tokenMint))],
        }))[0];
    }
    catch {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump token mint is not a valid public key.');
    }
}
export async function pumpGlobalAddress() {
    return (await getProgramDerivedAddress({
        programAddress: address(PUMP_PROGRAM_ID),
        seeds: [Buffer.from('global')],
    }))[0];
}
export async function pumpFeeConfigAddress() {
    return (await getProgramDerivedAddress({
        programAddress: address(PUMP_FEE_PROGRAM_ID),
        seeds: [Buffer.from('fee_config'), addressEncoder.encode(address(PUMP_PROGRAM_ID))],
    }))[0];
}
function selectFeeTier(tiers, marketCap) {
    let selected = tiers[0];
    for (const tier of tiers) {
        if (marketCap >= tier.marketCapLamportsThreshold)
            selected = tier;
    }
    return selected;
}
function ceilDiv(numerator, denominator) {
    if (numerator < 0n || denominator <= 0n) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Invalid integer division operands.');
    }
    return (numerator + denominator - 1n) / denominator;
}
function calculateFee(amount, bps) {
    return ceilDiv(amount * bps, BPS_DENOMINATOR);
}
export function validatePumpBondingCurve(curve) {
    if (curve.complete || curve.realTokenReserves === 0n) {
        throw new ExecutionEngineError('MARKET_MIGRATED', 'Pump bonding curve is complete or migrated.');
    }
    if (curve.virtualTokenReserves <= 0n ||
        curve.virtualSolReserves <= 0n ||
        curve.realTokenReserves < 0n ||
        curve.realSolReserves < 0n ||
        curve.tokenTotalSupply <= 0n) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump bonding curve reserves are invalid.');
    }
    if (curve.quoteMint !== ZERO_PUBLIC_KEY && curve.quoteMint !== WRAPPED_SOL_MINT) {
        throw new ExecutionEngineError('UNSUPPORTED_PROTOCOL', 'Pump quote asset requires composed execution through the canonical router.');
    }
}
const discardLog = () => undefined;
export class SolanaRpcClient {
    #url;
    #commitment;
    #timeoutMs;
    #fetch;
    #log;
    #requestId = 0;
    constructor(options) {
        if (!options.url)
            throw new ExecutionEngineError('RPC_ERROR', 'SOLANA_RPC_URL is required.');
        if ((options.timeoutMs ?? 10_000) <= 0) {
            throw new ExecutionEngineError('RPC_ERROR', 'SOLANA_RPC_TIMEOUT_MS must be positive.');
        }
        this.#url = options.url;
        this.#commitment = options.commitment ?? 'confirmed';
        this.#timeoutMs = options.timeoutMs ?? 10_000;
        this.#fetch = options.fetchImplementation ?? fetch;
        this.#log = options.log ?? discardLog;
    }
    /** Retry the same read at the same commitment; never change venue on transport failure. */
    async request(init) {
        const request = JSON.parse(String(init.body));
        let reason = 'Unknown RPC failure';
        const advisory = advisoryReadContext();
        const attempts = advisory ? 2 : 3;
        for (let attempt = 0; attempt < attempts; attempt++) {
            advisory?.signal.throwIfAborted();
            const started = performance.now();
            let retryAfter = 0;
            let networkEnded;
            if (advisory)
                advisory.metrics.rpcRequests++;
            const rpcRequest = structuredClone(request);
            if (advisory?.minimumSlot !== undefined && request.method === 'getMultipleAccounts')
                rpcRequest.params[1] = {
                    ...rpcRequest.params[1],
                    minContextSlot: advisory.minimumSlot,
                };
            try {
                const response = await this.#fetch(this.#url, {
                    ...init,
                    body: JSON.stringify(rpcRequest),
                    signal: advisory
                        ? AbortSignal.any([
                            advisory.signal,
                            AbortSignal.timeout(Math.min(1000, this.#timeoutMs)),
                        ])
                        : AbortSignal.timeout(this.#timeoutMs),
                });
                if (advisory && response.status === 429) {
                    advisory.metrics.rateLimits++;
                    const header = response.headers.get('retry-after');
                    retryAfter = header
                        ? /^\d+(?:\.\d+)?$/.test(header)
                            ? Number(header) * 1000
                            : Math.max(0, Date.parse(header) - Date.now())
                        : 1000;
                }
                if (!Number.isFinite(retryAfter) || retryAfter < 0)
                    retryAfter = 1000;
                if (advisory && retryAfter > 0)
                    advisory.metrics.rateLimitedUntil = Date.now() + retryAfter;
                if (!response.ok)
                    throw new Error(`HTTP ${response.status}`);
                const body = (await response.clone().json());
                if (body.error || body.result === undefined)
                    throw new Error(`Rejected JSON-RPC response (${body.error?.code ?? 'missing-result'})`);
                if (request.method === 'getMultipleAccounts') {
                    const result = body.result;
                    if (!Array.isArray(result?.value) ||
                        result.value.length !== request.params[0].length ||
                        !Number.isSafeInteger(result.context?.slot) ||
                        result.context.slot < 0 ||
                        result.value.some((a) => a !== null &&
                            (!a ||
                                typeof a.owner !== 'string' ||
                                !Array.isArray(a.data) ||
                                typeof a.data[0] !== 'string' ||
                                a.data[1] !== 'base64')))
                        throw new Error('Malformed RPC account snapshot');
                }
                if (advisory && request.method === 'getMultipleAccounts') {
                    const slot = body.result.context.slot;
                    if (advisory.minimumSlot !== undefined && slot < advisory.minimumSlot)
                        throw new Error('RPC slot regression');
                    advisory.minimumSlot = slot;
                }
                networkEnded = performance.now();
                return response;
            }
            catch (error) {
                networkEnded = performance.now();
                reason =
                    error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
                        ? 'Request timed out'
                        : error instanceof Error
                            ? safeErrorMessage(error, [this.#url])
                            : 'Transport failure';
                try {
                    this.#log('RPC_READ_RETRY', {
                        method: request.method,
                        attempt: attempt + 1,
                        commitment: this.#commitment,
                        reason,
                        finalCode: attempt === attempts - 1 ? 'RPC_UNAVAILABLE' : null,
                    });
                }
                catch {
                    /* Diagnostic failures cannot change read behavior. */
                }
                advisory?.signal.throwIfAborted();
                if (attempt < attempts - 1) {
                    if (advisory)
                        advisory.metrics.retries++;
                    const delay = advisory
                        ? Math.max(retryAfter, 100 * 2 ** attempt) * (1 + Math.random() * 0.25)
                        : 100 * 2 ** attempt;
                    await new Promise((resolve, reject) => {
                        const abort = () => {
                            clearTimeout(timer);
                            reject(advisory.signal.reason);
                        };
                        const timer = setTimeout(() => {
                            advisory?.signal.removeEventListener('abort', abort);
                            resolve();
                        }, delay);
                        advisory?.signal.addEventListener('abort', abort, { once: true });
                    });
                }
            }
            finally {
                if (advisory)
                    advisory.metrics.rpcMs += (networkEnded ?? performance.now()) - started;
            }
        }
        throw new ExecutionEngineError('RPC_UNAVAILABLE', `Solana RPC unavailable after ${attempts} attempts: ${reason}`);
    }
    async getMultipleAccounts(addresses) {
        try {
            const response = await this.request({
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: ++this.#requestId,
                    method: 'getMultipleAccounts',
                    params: [addresses, { encoding: 'base64', commitment: this.#commitment }],
                }),
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status.toString()}`);
            const body = (await response.json());
            if (body.error ||
                !body.result ||
                !Array.isArray(body.result.value) ||
                body.result.value.length !== addresses.length ||
                !Number.isSafeInteger(body.result.context?.slot) ||
                body.result.context.slot < 0) {
                throw new Error('Malformed or rejected JSON-RPC response');
            }
            return body.result;
        }
        catch (error) {
            if (error instanceof ExecutionEngineError)
                throw error;
            if (error instanceof Error && error.name === 'AbortError') {
                throw new ExecutionEngineError('RPC_UNAVAILABLE', 'Solana RPC request timed out.');
            }
            throw new ExecutionEngineError('RPC_UNAVAILABLE', 'Solana RPC request failed.');
        }
    }
    /** Mint discovery only. The caller must verify every candidate against the market PDA. */
    async getProgramAccountAddresses(programId, mint, mintOffset, size) {
        try {
            const response = await this.request({
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: ++this.#requestId,
                    method: 'getProgramAccounts',
                    params: [
                        programId,
                        {
                            encoding: 'base64',
                            commitment: this.#commitment,
                            filters: [{ dataSize: size }, { memcmp: { offset: mintOffset, bytes: mint } }],
                            dataSlice: { offset: 0, length: 0 },
                        },
                    ],
                }),
            });
            const body = (await response.json());
            if (!response.ok || !Array.isArray(body.result))
                throw new Error(`getProgramAccounts HTTP ${response.status}, RPC code ${body.error?.code ?? 'missing-result'}.`);
            if (body.result.length > 16)
                throw new Error('Discovery exceeds bounded pool count.');
            return body.result.map((a) => a.pubkey);
        }
        catch (error) {
            throw new ExecutionEngineError('RPC_UNAVAILABLE', `LAUNCHLAB_STATE_UNAVAILABLE: on-chain pool discovery failed (${safeErrorMessage(error, [this.#url], 'unknown error')}).`);
        }
    }
    async getOwnedTokenMints(owner) {
        try {
            const mints = [];
            for (const programId of [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
                const response = await this.request({
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: ++this.#requestId,
                        method: 'getTokenAccountsByOwner',
                        params: [
                            owner,
                            { programId },
                            {
                                encoding: 'base64',
                                commitment: this.#commitment,
                                dataSlice: { offset: 0, length: 32 },
                            },
                        ],
                    }),
                });
                const body = (await response.json());
                if (!response.ok || !body.result)
                    throw new Error('Token account discovery failed.');
                mints.push(...body.result.value.map(({ account }) => addressDecoder.decode(Buffer.from(account.data[0], 'base64'))));
            }
            return [...new Set(mints)];
        }
        catch {
            throw new ExecutionEngineError('RPC_UNAVAILABLE', 'Solana token-context discovery failed.');
        }
    }
}
export function solanaRpcClientFromEnvironment(environment = process.env) {
    const timeout = environment['SOLANA_RPC_TIMEOUT_MS'];
    const parsedTimeout = timeout === undefined || timeout === '' ? 10_000 : Number(timeout);
    if (!Number.isSafeInteger(parsedTimeout) || parsedTimeout <= 0) {
        throw new ExecutionEngineError('RPC_ERROR', 'SOLANA_RPC_TIMEOUT_MS must be a positive integer.');
    }
    const commitment = environment['SOLANA_COMMITMENT'];
    if (commitment !== undefined &&
        commitment !== '' &&
        commitment !== 'processed' &&
        commitment !== 'confirmed' &&
        commitment !== 'finalized') {
        throw new ExecutionEngineError('RPC_ERROR', 'SOLANA_COMMITMENT is invalid.');
    }
    return new SolanaRpcClient({
        url: environment['SOLANA_RPC_URL'] ?? '',
        timeoutMs: parsedTimeout,
        ...(commitment ? { commitment } : {}),
    });
}
function decodeRpcAccount(account, label) {
    if (!Array.isArray(account.data) || account.data[1] !== 'base64') {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', `${label} RPC encoding is invalid.`);
    }
    try {
        return Buffer.from(account.data[0], 'base64');
    }
    catch {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', `${label} account data is invalid.`);
    }
}
export class PumpFunSolanaMarketStateSource {
    rpc;
    log;
    constructor(rpc, log = discardLog) {
        this.rpc = rpc;
        this.log = log;
    }
    async loadMarketState(identity) {
        if (identity.protocolId !== PUMP_FUN_PROTOCOL_ID) {
            throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump protocol identity mismatch.');
        }
        const [bondingCurveAddress, globalAddress, feeConfigAddress] = await Promise.all([
            pumpBondingCurveAddress(identity.tokenMint),
            pumpGlobalAddress(),
            pumpFeeConfigAddress(),
        ]);
        if (identity.marketId !== bondingCurveAddress) {
            throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Requested market is not the bonding-curve PDA for the requested mint.');
        }
        const advisory = advisoryReadContext();
        const addresses = [
            bondingCurveAddress,
            globalAddress,
            feeConfigAddress,
            identity.tokenMint,
            ...(advisory ? [ADVISORY_CLOCK_ACCOUNT] : []),
        ];
        const response = await this.rpc.getMultipleAccounts(addresses);
        if (response.value.length !== addresses.length) {
            throw new ExecutionEngineError('RPC_ERROR', 'Solana RPC returned an inconsistent account set.');
        }
        const [curveAccount, globalAccount, feeConfigAccount, mintAccount] = response.value;
        if (!curveAccount) {
            throw new ExecutionEngineError('MARKET_ACCOUNT_NOT_FOUND', 'Pump bonding curve was not found.');
        }
        if (!globalAccount || !feeConfigAccount || !mintAccount) {
            throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'Required Pump market state is unavailable.');
        }
        if (curveAccount.owner !== PUMP_PROGRAM_ID || globalAccount.owner !== PUMP_PROGRAM_ID) {
            throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump account owner is invalid.');
        }
        if (feeConfigAccount.owner !== PUMP_FEE_PROGRAM_ID) {
            throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump fee config owner is invalid.');
        }
        if (mintAccount.owner !== SPL_TOKEN_PROGRAM_ID && mintAccount.owner !== TOKEN_2022_PROGRAM_ID) {
            throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump token mint owner is invalid.');
        }
        const curveBytes = decodeRpcAccount(curveAccount, 'Bonding curve');
        const globalBytes = decodeRpcAccount(globalAccount, 'Pump global');
        const feeConfigBytes = decodeRpcAccount(feeConfigAccount, 'Pump fee config');
        const mintBytes = decodeRpcAccount(mintAccount, 'Token mint');
        if (mintBytes.length < 82 || mintBytes[45] === 0) {
            throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump token mint account is invalid.');
        }
        const curve = decodePumpBondingCurve(curveBytes);
        validatePumpBondingCurve(curve);
        const global = decodePumpGlobal(globalBytes);
        const feeConfig = decodePumpFeeConfig(feeConfigBytes);
        const mintSupply = readU64(mintBytes, 36, 'Token mint');
        const tokenDecimals = mintBytes[44];
        const feeEvaluationMintSupply = curve.isMayhemMode ? mintSupply : ONE_BILLION_TOKEN_BASE_UNITS;
        const marketCap = (curve.virtualSolReserves * feeEvaluationMintSupply) / curve.virtualTokenReserves;
        const feeTier = selectFeeTier(feeConfig.feeTiers, marketCap);
        const creatorFeeBps = global.creatorFeeConfigurable && curve.creatorFeeBps > 0n
            ? curve.creatorFeeBps
            : feeTier.creatorFeeBps;
        if (feeTier.protocolFeeBps > BPS_DENOMINATOR || creatorFeeBps > BPS_DENOMINATOR) {
            throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump fee basis points are invalid.');
        }
        const normalizedState = {
            model: 'PUMP_FUN_BONDING_CURVE',
            ...(advisory
                ? { chainTime: advisoryClockTime(response.value[4], response.context.slot) }
                : {}),
            programId: PUMP_PROGRAM_ID,
            feeProgramId: PUMP_FEE_PROGRAM_ID,
            bondingCurveAddress,
            globalAddress,
            feeConfigAddress,
            tokenMint: identity.tokenMint,
            tokenProgram: mintAccount.owner,
            tokenDecimals: tokenDecimals.toString(),
            quoteAsset: 'SOL',
            virtualTokenReserves: curve.virtualTokenReserves.toString(),
            virtualSolReserves: curve.virtualSolReserves.toString(),
            realTokenReserves: curve.realTokenReserves.toString(),
            realSolReserves: curve.realSolReserves.toString(),
            tokenTotalSupply: curve.tokenTotalSupply.toString(),
            mintSupply: mintSupply.toString(),
            feeEvaluationMintSupply: feeEvaluationMintSupply.toString(),
            complete: curve.complete,
            creator: curve.creator,
            isMayhemMode: curve.isMayhemMode,
            isCashbackCoin: curve.isCashbackCoin,
            isHolderReward: curve.isHolderReward,
            configuredCreatorFeeBps: curve.creatorFeeBps.toString(),
            creatorFeeConfigurable: global.creatorFeeConfigurable,
            protocolFeeBps: feeTier.protocolFeeBps.toString(),
            creatorFeeBps: creatorFeeBps.toString(),
            feeTierMarketCapLamportsThreshold: feeTier.marketCapLamportsThreshold.toString(),
            feeConfigAccountLength: feeConfig.accountLength.toString(),
        };
        const state = {
            identity,
            observedAt: new Date().toISOString(),
            chainSlot: BigInt(response.context.slot),
            chainBlockId: null,
            adapterVersion: PUMP_FUN_ADAPTER_VERSION,
            normalizationVersion: PUMP_FUN_NORMALIZATION_VERSION,
            normalizedState,
            rawSource: {
                source: 'solana-json-rpc:getMultipleAccounts',
                addresses,
                accountDataBase64: [
                    curveAccount.data[0],
                    globalAccount.data[0],
                    feeConfigAccount.data[0],
                    mintAccount.data[0],
                ],
            },
        };
        this.log('pump_market_state_loaded', {
            protocol: PUMP_FUN_PROTOCOL_ID,
            market: identity.marketId,
            mint: identity.tokenMint,
            stateSlot: response.context.slot.toString(),
            adapterVersion: PUMP_FUN_ADAPTER_VERSION,
        });
        return state;
    }
}
function asPumpState(state) {
    const value = state.normalizedState;
    const requiredStrings = [
        'bondingCurveAddress',
        'tokenMint',
        'virtualTokenReserves',
        'virtualSolReserves',
        'realTokenReserves',
        'realSolReserves',
        'tokenTotalSupply',
        'mintSupply',
        'protocolFeeBps',
        'creatorFeeBps',
    ];
    if (state.adapterVersion !== PUMP_FUN_ADAPTER_VERSION ||
        state.normalizationVersion !== PUMP_FUN_NORMALIZATION_VERSION ||
        value['model'] !== 'PUMP_FUN_BONDING_CURVE' ||
        value['programId'] !== PUMP_PROGRAM_ID ||
        value['quoteAsset'] !== 'SOL' ||
        value['complete'] !== false ||
        requiredStrings.some((key) => typeof value[key] !== 'string')) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Normalized Pump market state is invalid.');
    }
    if (value['tokenMint'] !== state.identity.tokenMint ||
        value['bondingCurveAddress'] !== state.identity.marketId) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Normalized Pump market identity is invalid.');
    }
    return value;
}
function mathState(state) {
    const normalized = asPumpState(state);
    const result = {
        virtualToken: BigInt(normalized.virtualTokenReserves),
        virtualSol: BigInt(normalized.virtualSolReserves),
        realToken: BigInt(normalized.realTokenReserves),
        realSol: BigInt(normalized.realSolReserves),
        protocolFeeBps: BigInt(normalized.protocolFeeBps),
        creatorFeeBps: BigInt(normalized.creatorFeeBps),
        creatorFeeApplies: normalized.creator !== ZERO_PUBLIC_KEY,
    };
    if (result.virtualToken <= 0n || result.virtualSol <= 0n || result.realToken <= 0n) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Normalized Pump reserves are impossible.');
    }
    return result;
}
function feesFor(amount, state) {
    const protocol = calculateFee(amount, state.protocolFeeBps);
    const creator = state.creatorFeeApplies ? calculateFee(amount, state.creatorFeeBps) : 0n;
    return { protocol, creator, total: protocol + creator };
}
function feeBreakdown(value) {
    const fees = [];
    if (value.protocol > 0n) {
        fees.push({
            category: 'PUMP_FUN_PROTOCOL_FEE',
            amount: { asset: 'PAPER_SOL', amount: paperSolBaseUnits(value.protocol) },
        });
    }
    if (value.creator > 0n) {
        fees.push({
            category: 'PUMP_FUN_CREATOR_FEE',
            amount: { asset: 'PAPER_SOL', amount: paperSolBaseUnits(value.creator) },
        });
    }
    return { fees, totalPaperSolFees: paperSolBaseUnits(value.total) };
}
function simulatePumpBuyAmount(maximumTotalInput, state) {
    if (maximumTotalInput <= 0n) {
        throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Pump BUY input must be positive.');
    }
    const totalFeeBps = state.protocolFeeBps + (state.creatorFeeApplies ? state.creatorFeeBps : 0n);
    const curveBudget = maximumTotalInput <= 1n
        ? 0n
        : ((maximumTotalInput - 1n) * BPS_DENOMINATOR) / (BPS_DENOMINATOR + totalFeeBps);
    const uncappedOutput = (curveBudget * state.virtualToken) / (state.virtualSol + curveBudget);
    const tokenOutput = uncappedOutput < state.realToken ? uncappedOutput : state.realToken;
    if (tokenOutput <= 0n || tokenOutput >= state.virtualToken) {
        throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Pump BUY produces no valid token output.');
    }
    const curveInput = (tokenOutput * state.virtualSol) / (state.virtualToken - tokenOutput) + 1n;
    const fees = feesFor(curveInput, state);
    const totalInput = curveInput + fees.total;
    if (totalInput > maximumTotalInput) {
        throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Pump BUY exceeds requested total input.');
    }
    const postVirtualToken = state.virtualToken - tokenOutput;
    const postVirtualSol = state.virtualSol + curveInput;
    const postRealToken = state.realToken - tokenOutput;
    const postRealSol = state.realSol + curveInput;
    if (postVirtualToken <= 0n || postRealToken < 0n) {
        throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Pump BUY reserve result is invalid.');
    }
    const averageVsSpotBps = (totalInput * state.virtualToken * BPS_DENOMINATOR) / (tokenOutput * state.virtualSol) -
        BPS_DENOMINATOR;
    return {
        totalInput,
        curveInput,
        tokenOutput,
        fees,
        details: {
            curveInputLamports: curveInput.toString(),
            requestedMaximumTotalLamports: maximumTotalInput.toString(),
            protocolFeeLamports: fees.protocol.toString(),
            creatorFeeLamports: fees.creator.toString(),
            averageVsPreTradeSpotBps: averageVsSpotBps.toString(),
            postTrade: {
                virtualTokenReserves: postVirtualToken.toString(),
                virtualSolReserves: postVirtualSol.toString(),
                realTokenReserves: postRealToken.toString(),
                realSolReserves: postRealSol.toString(),
            },
        },
    };
}
function simulatePumpSellAmount(tokenInput, state) {
    if (tokenInput <= 0n) {
        throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Pump SELL input must be positive.');
    }
    const grossSolOutput = (tokenInput * state.virtualSol) / (state.virtualToken + tokenInput);
    const fees = feesFor(grossSolOutput, state);
    const netSolOutput = grossSolOutput - fees.total;
    if (grossSolOutput <= 0n || netSolOutput <= 0n || grossSolOutput > state.realSol) {
        throw new ExecutionEngineError(grossSolOutput > state.realSol
            ? 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'
            : 'ZERO_EXECUTABLE_OUTPUT', 'Pump SELL exceeds real reserves or produces no net SOL.');
    }
    const postVirtualToken = state.virtualToken + tokenInput;
    const postVirtualSol = state.virtualSol - grossSolOutput;
    const postRealToken = state.realToken + tokenInput;
    const postRealSol = state.realSol - grossSolOutput;
    if (postVirtualSol <= 0n || postRealSol < 0n) {
        throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Pump SELL reserve result is invalid.');
    }
    const spotVsAverageBps = BPS_DENOMINATOR -
        (netSolOutput * state.virtualToken * BPS_DENOMINATOR) / (tokenInput * state.virtualSol);
    return {
        tokenInput,
        grossSolOutput,
        netSolOutput,
        fees,
        details: {
            grossSolOutputLamports: grossSolOutput.toString(),
            protocolFeeLamports: fees.protocol.toString(),
            creatorFeeLamports: fees.creator.toString(),
            preTradeSpotVsAverageBps: spotVsAverageBps.toString(),
            postTrade: {
                virtualTokenReserves: postVirtualToken.toString(),
                virtualSolReserves: postVirtualSol.toString(),
                realTokenReserves: postRealToken.toString(),
                realSolReserves: postRealSol.toString(),
            },
        },
    };
}
function assertIdentity(expected, actual) {
    if (expected.protocolId !== actual.protocolId ||
        expected.marketId !== actual.marketId ||
        expected.tokenMint !== actual.tokenMint) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump market-state identity mismatch.');
    }
}
export class PumpFunProtocolAdapter {
    source;
    log;
    protocolId = PUMP_FUN_PROTOCOL_ID;
    adapterVersion = PUMP_FUN_ADAPTER_VERSION;
    async maxExecutableSellQuantity(request, marketState) {
        assertIdentity(request.identity, marketState.identity);
        const state = mathState(marketState);
        if (state.protocolFeeBps + (state.creatorFeeApplies ? state.creatorFeeBps : 0n) >=
            BPS_DENOMINATOR)
            return tokenBaseUnits(0n);
        return tokenBaseUnits(maximumConstantProductSell(request.tokenQuantity, state.virtualToken, state.virtualSol, (gross) => gross <= state.realSol && gross < state.virtualSol, (gross) => gross - feesFor(gross, state).total));
    }
    constructor(source, log = discardLog) {
        this.source = source;
        this.log = log;
    }
    async loadMarketState(identity) {
        try {
            const state = await this.source.loadMarketState(identity);
            assertIdentity(identity, state.identity);
            asPumpState(state);
            return state;
        }
        catch (error) {
            this.log('pump_market_state_failed', {
                protocol: this.protocolId,
                market: identity.marketId,
                mint: identity.tokenMint,
                adapterVersion: this.adapterVersion,
                errorCode: error instanceof ExecutionEngineError ? error.code : 'MARKET_STATE_UNAVAILABLE',
            });
            throw error;
        }
    }
    async simulateBuy(request, marketState) {
        assertIdentity(request.identity, marketState.identity);
        const result = simulatePumpBuyAmount(request.requestedPaperSol, mathState(marketState));
        const execution = this.execution(request, marketState, { asset: 'PAPER_SOL', amount: request.requestedPaperSol }, { asset: 'PAPER_SOL', amount: paperSolBaseUnits(result.totalInput) }, {
            asset: 'TOKEN',
            tokenMint: request.identity.tokenMint,
            amount: tokenBaseUnits(result.tokenOutput),
        }, feeBreakdown(result.fees).fees, result.details);
        this.log('pump_execution_simulated', {
            protocol: this.protocolId,
            market: request.identity.marketId,
            mint: request.identity.tokenMint,
            stateSlot: marketState.chainSlot?.toString() ?? null,
            adapterVersion: this.adapterVersion,
            executionId: request.executionId,
            evidenceFingerprint: execution.quote.marketStateFingerprint,
        });
        return execution;
    }
    async simulateSell(request, marketState) {
        assertIdentity(request.identity, marketState.identity);
        const result = simulatePumpSellAmount(request.requestedTokenQuantity, mathState(marketState));
        const execution = this.execution(request, marketState, {
            asset: 'TOKEN',
            tokenMint: request.identity.tokenMint,
            amount: request.requestedTokenQuantity,
        }, {
            asset: 'TOKEN',
            tokenMint: request.identity.tokenMint,
            amount: tokenBaseUnits(result.tokenInput),
        }, { asset: 'PAPER_SOL', amount: paperSolBaseUnits(result.netSolOutput) }, feeBreakdown(result.fees).fees, result.details);
        this.log('pump_execution_simulated', {
            protocol: this.protocolId,
            market: request.identity.marketId,
            mint: request.identity.tokenMint,
            stateSlot: marketState.chainSlot?.toString() ?? null,
            adapterVersion: this.adapterVersion,
            executionId: request.executionId,
            evidenceFingerprint: execution.quote.marketStateFingerprint,
        });
        return execution;
    }
    async valuePositionForExit(request, marketState) {
        assertIdentity(request.identity, marketState.identity);
        const result = simulatePumpSellAmount(request.tokenQuantity, mathState(marketState));
        const evidence = createMarketStateEvidence(marketState);
        return {
            identity: request.identity,
            tokenQuantity: request.tokenQuantity,
            paperSolValue: paperSolBaseUnits(result.netSolOutput),
            feeBreakdown: feeBreakdown(result.fees),
            marketStateFingerprint: evidence.fingerprint,
            adapterVersion: this.adapterVersion,
        };
    }
    execution(request, marketState, requestedInput, actualInput, output, fees, executionDetails) {
        const evidence = createMarketStateEvidence(marketState);
        return {
            id: request.executionId,
            orderId: request.orderId,
            quote: {
                orderId: request.orderId,
                marketId: request.identity.marketId,
                protocolId: this.protocolId,
                adapterVersion: this.adapterVersion,
                marketStateRecordedAt: marketState.observedAt,
                marketStateFingerprint: evidence.fingerprint,
                normalizationVersion: marketState.normalizationVersion,
                requestedInput,
                simulatedOutput: output,
                fees,
            },
            actualInput,
            actualOutput: output,
            executedAt: request.executedAt,
            executionDetails,
        };
    }
}
export function pumpPaperSolFeeTotal(fees) {
    return paperSolBaseUnits(fees.reduce((total, fee) => (fee.amount.asset === 'PAPER_SOL' ? total + fee.amount.amount : total), 0n));
}
export function pumpTokenAmount(value) {
    return tokenBaseUnits(value);
}
//# sourceMappingURL=pump-fun.js.map