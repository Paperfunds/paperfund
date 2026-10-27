/** Stage 1 only: no production barrel export, adapter registration, API or runtime flag. */
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { unpackMint, unpackAccount, getExtensionTypes, getTransferFeeConfig, getTransferHook, getDefaultAccountState, getPausableConfig, getAssociatedTokenAddressSync, } from '@solana/spl-token';
import { ExecutionEngineError } from '@paperfund/execution';
import { decodePumpBondingCurve, pumpBondingCurveAddress, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, WRAPPED_SOL_MINT, } from '../pump-fun.js';
import { decodePumpSwapPool, decodePumpSwapGlobalConfig, decodePumpSwapFeeConfig, canonicalPumpSwapPoolAddress, pumpPoolAuthorityAddress, pumpSwapGlobalConfigAddress, pumpSwapFeeConfigAddress, PUMP_AMM_PROGRAM_ID, } from '../pump-swap.js';
import { orcaLink, quoteSupplementalHop, ORCA_WHIRLPOOL_PROGRAM } from '../composed-pump-orca.js';
const CLOCK = 'SysvarC1ock11111111111111111111111111111111';
const U64 = (1n << 64n) - 1n;
export const STAGE1_BRIDGES = Object.freeze({
    XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN: 'Bh3njVo6i3UjgmaevEQMGoidphcueNjoPqGkYLbthzV5',
    pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn: 'BofA2ViUSudPBTUms2KRuG6AHNeMawjNfwqTJDgx5BKW',
});
function fail(reason) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', reason);
}
function liquidity(reason) {
    throw new ExecutionEngineError('INSUFFICIENT_EXECUTABLE_LIQUIDITY', reason);
}
function dust() {
    throw new ExecutionEngineError('ZERO_EXECUTABLE_OUTPUT', 'STAGE1_DUST');
}
function u64(n) {
    if (typeof n !== 'bigint' || n < 0n || n > U64)
        fail('STAGE1_INVALID_U64');
    return n;
}
const ceil = (n, d) => (n + d - 1n) / d;
function checked(s) {
    for (const n of [s.base, s.quote, s.protocolBucket, s.creatorBucket])
        u64(n);
    if (s.virtual < -(1n << 127n) || s.virtual >= 1n << 127n)
        fail('STAGE1_INVALID_VIRTUAL');
    if (s.base === 0n ||
        s.quote + s.virtual <= 0n ||
        s.quote + s.virtual > U64 ||
        s.protocolBucket + s.creatorBucket > s.quote)
        fail('STAGE1_INVALID_RESERVES');
    if ([s.lpBps, s.protocolBps, s.creatorBps, s.buybackBps].some((n) => typeof n !== 'bigint' || n < 0n || n > 10000n) ||
        s.lpBps + s.protocolBps + s.creatorBps >= 10000n)
        fail('STAGE1_INVALID_FEES');
}
/** Asset-neutral v2 math. All components are quote-token units, never SOL aliases. */
export function stage1PoolSwap(s, input, buy) {
    checked(s);
    u64(input);
    if (input === 0n)
        dust();
    const effective = s.quote + s.virtual;
    const fee = (n, b) => ceil(n * b, 10000n);
    const pricingBase = buy
        ? (input * 10000n) / (10000n + s.lpBps + s.protocolBps + s.creatorBps)
        : (effective * input) / (s.base + input);
    const lp = fee(pricingBase, s.lpBps), protocol = fee(pricingBase, s.protocolBps), creator = fee(pricingBase, s.creatorBps);
    const net = buy ? input - lp - protocol - creator : pricingBase - lp - protocol - creator;
    if (net <= 0n || (buy && net <= 1n))
        dust();
    if (!buy && pricingBase - lp > s.quote - s.protocolBucket - s.creatorBucket)
        liquidity('STAGE1_TARGET_REAL_RESERVES');
    const output = buy ? (s.base * (net - 1n)) / (effective + net - 1n) : net;
    if (output <= 0n)
        dust();
    u64(output);
    const buyback = (protocol * s.buybackBps) / 10000n;
    const retained = protocol - buyback + creator;
    const post = {
        ...s,
        base: buy ? s.base - output : s.base + input,
        quote: buy ? s.quote + input - buyback : s.quote - output - buyback,
        virtual: s.virtual - retained,
        protocolBucket: s.protocolBucket + protocol - buyback,
        creatorBucket: s.creatorBucket + creator,
    };
    checked(post);
    return {
        input,
        output,
        grossQuote: buy ? net : pricingBase,
        fees: { lp, protocol, creator, buyback },
        post,
    };
}
const info = (a) => ({
    data: Buffer.from(a.base64, 'base64'),
    owner: new PublicKey(a.owner),
    executable: false,
    lamports: 0,
    rentEpoch: 0,
});
function need(s, address) {
    const a = s.accounts[address];
    if (!a)
        fail('STAGE1_REQUIRED_ACCOUNT_MISSING: ' + address);
    return a;
}
export function validatePumpSwapMint(s, address) {
    const a = need(s, address);
    if (![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner))
        fail('STAGE1_MINT_OWNER');
    const m = unpackMint(new PublicKey(address), info(a), new PublicKey(a.owner));
    if (!m.isInitialized || m.decimals > 18 || (m.supply === 0n && address !== WRAPPED_SOL_MINT))
        fail('STAGE1_MINT_STATE');
    const known = new Set([0, 1, 3, 4, 6, 10, 12, 14, 18, 19, 20, 21, 22, 23, 25, 26, 28]);
    if (getExtensionTypes(m.tlvData).some((t) => !known.has(t)))
        fail('STAGE1_TOKEN_EXTENSION_UNSUPPORTED');
    const tf = getTransferFeeConfig(m);
    if (tf &&
        (tf.olderTransferFee.transferFeeBasisPoints !== 0 ||
            tf.newerTransferFee.transferFeeBasisPoints !== 0))
        fail('STAGE1_TRANSFER_FEES_UNSUPPORTED');
    const hook = getTransferHook(m);
    if ((hook && !hook.programId.equals(PublicKey.default)) ||
        getDefaultAccountState(m)?.state === 2 ||
        getPausableConfig(m)?.paused)
        fail('STAGE1_TOKEN_TRANSFER_BLOCKED');
    return m;
}
function vault(s, address, expectedMint, authority) {
    const a = need(s, address), program = need(s, expectedMint).owner;
    if (a.owner !== program)
        fail('STAGE1_VAULT_PROGRAM');
    const v = unpackAccount(new PublicKey(address), info(a), new PublicKey(program));
    if (!v.isInitialized ||
        v.isFrozen ||
        v.mint.toBase58() !== expectedMint ||
        v.owner.toBase58() !== authority)
        fail('STAGE1_VAULT_IDENTITY');
    return v;
}
export class Stage1NonSolPumpSwap {
    constructor(options) {
        this.bridgeBinding = options?.bridgeBinding
            ? Object.freeze({ ...options.bridgeBinding })
            : undefined;
        if (options?.purpose !== 'READ_ONLY_STAGE1_VALIDATION')
            fail('STAGE1_DISABLED');
    }
    bridgeBinding;
    bridgeFor(quote) {
        return this.bridgeBinding
            ? this.bridgeBinding.quoteMint === quote
                ? this.bridgeBinding.pool
                : undefined
            : STAGE1_BRIDGES[quote];
    }
    /** Discovery inputs are addresses only. No indexer price, trading method, signing or DB access. */
    async capture(rpc, targetMint) {
        const curve = await pumpBondingCurveAddress(targetMint);
        const first = await rpc.getMultipleAccounts([curve]);
        const a = first.value[0];
        if (!a || a.owner !== PUMP_PROGRAM_ID)
            fail('STAGE1_PUMP_ORIGIN_MISSING');
        const c = decodePumpBondingCurve(Buffer.from(a.data[0], 'base64'));
        if (!c.complete)
            fail('STAGE1_MIGRATION_NOT_COMPLETE');
        const bridge = this.bridgeFor(c.quoteMint);
        if (!bridge)
            fail('STAGE1_QUOTE_UNSUPPORTED');
        const target = await canonicalPumpSwapPoolAddress(targetMint, c.quoteMint);
        const discovery = await rpc.getMultipleAccounts([target, bridge]);
        const p = discovery.value[0], b = discovery.value[1];
        if (!p || p.owner !== PUMP_AMM_PROGRAM_ID || !b || b.owner !== ORCA_WHIRLPOOL_PROGRAM)
            fail('STAGE1_POOLS_MISSING');
        const pool = decodePumpSwapPool(Buffer.from(p.data[0], 'base64'));
        const link = orcaLink(bridge, { owner: b.owner, base64: b.data[0] });
        const addresses = [
            ...new Set([
                curve,
                target,
                targetMint,
                c.quoteMint,
                pool.baseVault,
                pool.quoteVault,
                bridge,
                link.mintA,
                link.mintB,
                link.vaultA,
                link.vaultB,
                link.config,
                ...(link.extraAccounts ?? []),
                await pumpSwapGlobalConfigAddress(),
                await pumpSwapFeeConfigAddress(),
                CLOCK,
            ]),
        ];
        if (addresses.length > 100)
            fail('STAGE1_BATCH_TOO_LARGE');
        const batch = await rpc.getMultipleAccounts(addresses);
        if (!Number.isSafeInteger(batch.context.slot) ||
            batch.context.slot < 0 ||
            batch.value.length !== addresses.length)
            fail('STAGE1_BATCH_INCONSISTENT');
        const accounts = {}, absentAccounts = [];
        addresses.forEach((address, i) => {
            const v = batch.value[i];
            if (v)
                accounts[address] = { owner: v.owner, base64: v.data[0] };
            else
                absentAccounts.push(address);
        });
        const snapshot = {
            version: 'NON_SOL_PUMPSWAP_STAGE1_V1',
            mint: targetMint,
            quoteMint: c.quoteMint,
            targetPool: target,
            bridgePool: bridge,
            slot: batch.context.slot,
            observedAt: new Date().toISOString(),
            accounts,
            absentAccounts,
        };
        await this.validate(snapshot, { nowMs: Date.parse(snapshot.observedAt), maxAgeMs: 10000 });
        return snapshot;
    }
    async validate(s, policy) {
        if (s.version !== 'NON_SOL_PUMPSWAP_STAGE1_V1' ||
            !Number.isSafeInteger(s.slot) ||
            s.slot < 0 ||
            this.bridgeFor(s.quoteMint) !== s.bridgePool)
            fail('STAGE1_SNAPSHOT_IDENTITY');
        const now = policy.nowMs, at = Date.parse(s.observedAt);
        if (!Number.isFinite(now) ||
            !Number.isFinite(at) ||
            !Number.isFinite(policy.maxAgeMs) ||
            policy.maxAgeMs <= 0 ||
            at > now ||
            now - at > policy.maxAgeMs)
            fail('STAGE1_STALE_CAPTURE');
        const clock = Buffer.from(need(s, CLOCK).base64, 'base64');
        if (need(s, CLOCK).owner !== 'Sysvar1111111111111111111111111111111111111' ||
            clock.length !== 40 ||
            clock.readBigUInt64LE(0) > BigInt(s.slot))
            fail('STAGE1_CLOCK_INCONSISTENT');
        const time = clock.readBigInt64LE(32), epoch = clock.readBigUInt64LE(16);
        if (BigInt(Math.floor(now)) < time * 1000n ||
            BigInt(Math.floor(now)) - time * 1000n > BigInt(Math.ceil(policy.maxAgeMs)))
            fail('STAGE1_STALE_BANK');
        const curveAddress = await pumpBondingCurveAddress(s.mint), curveAccount = need(s, curveAddress);
        if (curveAccount.owner !== PUMP_PROGRAM_ID)
            fail('STAGE1_CURVE_OWNER');
        const curve = decodePumpBondingCurve(Buffer.from(curveAccount.base64, 'base64'));
        if (!curve.complete || curve.quoteMint !== s.quoteMint)
            fail('STAGE1_MIGRATION_IDENTITY');
        const poolAccount = need(s, s.targetPool), poolBytes = Buffer.from(poolAccount.base64, 'base64');
        if (poolAccount.owner !== PUMP_AMM_PROGRAM_ID || ![287, 300, 301].includes(poolBytes.length))
            fail('STAGE1_POOL_LAYOUT_UNSUPPORTED');
        const p = decodePumpSwapPool(poolBytes);
        if (s.targetPool !== (await canonicalPumpSwapPoolAddress(s.mint, s.quoteMint)) ||
            p.index !== 0 ||
            p.creator !== (await pumpPoolAuthorityAddress(s.mint)) ||
            p.baseMint !== s.mint ||
            p.quoteMint !== s.quoteMint)
            fail('STAGE1_CANONICAL_IDENTITY');
        if ([243, 244, 269, 270].some((i) => poolBytes[i] > 1) ||
            poolBytes.subarray(287).some((b) => b !== 0))
            fail('STAGE1_POOL_FLAGS_OR_TAIL');
        if (p.isMayhemMode || p.isCashbackCoin || p.canEditCreatorFee || poolBytes[270] > 1)
            fail('STAGE1_FLAGS_UNSUPPORTED');
        for (const address of [s.mint, s.quoteMint, WRAPPED_SOL_MINT])
            validatePumpSwapMint(s, address);
        for (const [address, m] of [
            [p.baseVault, s.mint],
            [p.quoteVault, s.quoteMint],
        ])
            if (getAssociatedTokenAddressSync(new PublicKey(m), new PublicKey(s.targetPool), true, new PublicKey(need(s, m).owner)).toBase58() !== address)
                fail('STAGE1_TARGET_ATA');
        const base = vault(s, p.baseVault, s.mint, s.targetPool), quote = vault(s, p.quoteVault, s.quoteMint, s.targetPool);
        const globalAddress = await pumpSwapGlobalConfigAddress(), feeAddress = await pumpSwapFeeConfigAddress();
        if (need(s, globalAddress).owner !== PUMP_AMM_PROGRAM_ID ||
            need(s, feeAddress).owner !== PUMP_FEE_PROGRAM_ID)
            fail('STAGE1_CONFIG_OWNER');
        const globalBytes = Buffer.from(need(s, globalAddress).base64, 'base64'), g = decodePumpSwapGlobalConfig(globalBytes);
        if (globalBytes.length !== 949 ||
            g.disableFlags !== 0 ||
            [417, 642, 939, 940].some((i) => globalBytes[i] > 1))
            fail('STAGE1_GLOBAL_STATE_UNSUPPORTED');
        const fBytes = Buffer.from(need(s, feeAddress).base64, 'base64'), legacy = decodePumpSwapFeeConfig(fBytes);
        // Versioned vectors are packed consecutively. New fields are gated by total account size.
        let end = 69 + fBytes.readUInt32LE(65) * 40;
        if (fBytes.length >= 4073) {
            if (end + 4 > fBytes.length)
                fail('STAGE1_FEE_LAYOUT');
            end += 4 + fBytes.readUInt32LE(end) * 40;
        }
        let fees = legacy.flatFees;
        if (fBytes.length >= 4097) {
            if (end + 24 > fBytes.length)
                fail('STAGE1_FEE_LAYOUT');
            const exotic = {
                lpFeeBps: fBytes.readBigUInt64LE(end),
                protocolFeeBps: fBytes.readBigUInt64LE(end + 8),
                creatorFeeBps: fBytes.readBigUInt64LE(end + 16),
            };
            if (exotic.lpFeeBps + exotic.protocolFeeBps + exotic.creatorFeeBps > 0n)
                fees = exotic;
        }
        if (![2512, 4073, 4097].includes(fBytes.length))
            fail('STAGE1_FEE_LAYOUT_UNSUPPORTED');
        const creator = g.creatorFeeConfigurable && p.creatorFeeBps > 0n ? p.creatorFeeBps : fees.creatorFeeBps;
        if (g.creatorFeeConfigurable && creator > g.maxConfigurableCreatorFeeBps)
            fail('STAGE1_CREATOR_FEE_LIMIT');
        const math = {
            base: base.amount,
            quote: quote.amount,
            virtual: p.virtualQuoteReserves,
            protocolBucket: poolBytes.readBigUInt64LE(271),
            creatorBucket: poolBytes.readBigUInt64LE(279),
            lpBps: fees.lpFeeBps,
            protocolBps: fees.protocolFeeBps,
            creatorBps: p.coinCreator === PublicKey.default.toBase58() ? 0n : creator,
            buybackBps: globalBytes.readBigUInt64LE(899),
        };
        checked(math);
        const bridge = orcaLink(s.bridgePool, need(s, s.bridgePool));
        if (![bridge.mintA, bridge.mintB].includes(s.quoteMint) ||
            ![bridge.mintA, bridge.mintB].includes(WRAPPED_SOL_MINT))
            fail('STAGE1_BRIDGE_ORIENTATION');
        if ((bridge.extraAccounts ?? []).some((a) => !s.accounts[a] && !s.absentAccounts.includes(a)))
            fail('STAGE1_TICK_CAPTURE_CHANGED');
        vault(s, bridge.vaultA, bridge.mintA, s.bridgePool);
        vault(s, bridge.vaultB, bridge.mintB, s.bridgePool);
        if (s.absentAccounts.some((a) => s.accounts[a]))
            fail('STAGE1_ABSENT_ACCOUNT_CONFLICT');
        return {
            math,
            bridge,
            time,
            epoch,
            holderReward: poolBytes[270] === 1,
            baseDecimals: validatePumpSwapMint(s, s.mint).decimals,
            quoteDecimals: validatePumpSwapMint(s, s.quoteMint).decimals,
        };
    }
    async quote(snapshot, input, buy, policy) {
        const s = structuredClone(snapshot);
        const v = await this.validate(s, policy);
        u64(input);
        if (input === 0n)
            dust();
        const bridgeQuote = (amount, fromSol) => {
            const result = quoteSupplementalHop(v.bridge, s.accounts, amount, v.bridge.mintA === (fromSol ? WRAPPED_SOL_MINT : s.quoteMint), v.time, validatePumpSwapMint(s, s.quoteMint).supply, s.absentAccounts);
            const outVault = vault(s, fromSol
                ? v.bridge.mintA === WRAPPED_SOL_MINT
                    ? v.bridge.vaultB
                    : v.bridge.vaultA
                : v.bridge.mintA === WRAPPED_SOL_MINT
                    ? v.bridge.vaultA
                    : v.bridge.vaultB, fromSol ? s.quoteMint : WRAPPED_SOL_MINT, s.bridgePool);
            if (result.output > outVault.amount)
                liquidity('STAGE1_BRIDGE_RESERVES');
            if (result.output <= 0n)
                dust();
            return result;
        };
        const bridge = buy ? bridgeQuote(input, true) : null;
        const target = stage1PoolSwap(v.math, bridge?.output ?? input, buy);
        const reverse = buy ? null : bridgeQuote(target.output, false);
        return {
            version: s.version,
            slot: s.slot,
            mint: s.mint,
            quoteMint: s.quoteMint,
            creatorFeeDestination: v.holderReward ? 'HOLDER_REWARD' : 'CREATOR',
            input,
            output: reverse?.output ?? target.output,
            buy,
            target,
            bridge: bridge ?? reverse,
            baseDecimals: v.baseDecimals,
            quoteDecimals: v.quoteDecimals,
            fingerprint: createHash('sha256').update(JSON.stringify(s)).digest('hex'),
        };
    }
    async exits(snapshot, quantity, policy) {
        const s = structuredClone(snapshot);
        u64(quantity);
        if (quantity === 0n)
            dust();
        const read = async (q) => {
            try {
                return { quantity: q, quote: await this.quote(s, q, false, policy), reason: null };
            }
            catch (e) {
                if (!(e instanceof ExecutionEngineError) ||
                    !['ZERO_EXECUTABLE_OUTPUT', 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'].includes(e.code))
                    throw e;
                return { quantity: q, quote: null, reason: e.code };
            }
        };
        const full = await read(quantity);
        let max = quantity;
        if (!full.quote) {
            let low = 0n, high = quantity;
            while (low < high) {
                const mid = (low + high + 1n) / 2n, r = await read(mid);
                if (r.reason === 'INSUFFICIENT_EXECUTABLE_LIQUIDITY')
                    high = mid - 1n;
                else
                    low = mid;
            }
            max = low;
        }
        const capacity = await read(max);
        if (!capacity.quote)
            max = 0n;
        return {
            full,
            maxQuantity: max,
            maxOutput: capacity.quote?.output ?? 0n,
            percentages: await Promise.all([25n, 50n, 75n].map((p) => read((quantity * p) / 100n))),
        };
    }
}
//# sourceMappingURL=non-sol-pump-swap.js.map