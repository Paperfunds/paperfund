/** Offline Stage 1 only. Deliberately absent from package exports and production wiring. */
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { unpackMint } from '@solana/spl-token';
import { cpAmmCoder, getFeeMode, getSwapResultFromExactInput, } from '@meteora-ag/cp-amm-sdk';
import { createMarketStateEvidence, ExecutionEngineError, } from '@paperfund/execution';
import { quoteSupplementalHop } from '../composed-pump-orca.js';
import { PUMP_PROGRAM_ID } from '../pump-fun.js';
import { METEORA_DAMM_V2_PROGRAM, quoteRecordedRoute, } from '../solana-routes.js';
const CLOCK = 'SysvarC1ock11111111111111111111111111111111';
const U64 = (1n << 64n) - 1n;
const Q64 = 1n << 64n;
const bn = (n) => new BN(n.toString());
const integer = (n) => BigInt(n.toString());
export class SequentialTransitionError extends Error {
    code = 'UNSUPPORTED_STATE_TRANSITION';
}
const unsupported = (message) => {
    throw new SequentialTransitionError(message);
};
function guard(operation) {
    try {
        return operation();
    }
    catch (error) {
        if (error instanceof SequentialTransitionError || error instanceof ExecutionEngineError)
            throw error;
        return unsupported('Captured evidence cannot establish a supported deterministic transition.');
    }
}
function snapshot(state) {
    const s = state.normalizedState;
    if (state.adapterVersion !== 'solana-composed-route-v1' ||
        s['model'] !== 'SOLANA_COMPOSED_ROUTE' ||
        s['routePolicy'] !== 'FIXED_TOPOLOGY_V1' ||
        !Array.isArray(s['hops']) ||
        !s['hops'].length ||
        state.chainSlot === null)
        unsupported('Only recorded fixed-topology composed routes are supported.');
    const hops = s['hops'];
    if (new Set(hops.map((h) => h.pool)).size !== hops.length ||
        hops.some((h) => ![PUMP_PROGRAM_ID, METEORA_DAMM_V2_PROGRAM].includes(h.program)))
        unsupported('Repeated pools or an unimplemented protocol transition.');
    const accounts = s['accounts'];
    if (!accounts || typeof accounts !== 'object')
        unsupported('Missing captured accounts.');
    return { hops, accounts };
}
function bytes(accounts, address) {
    const a = accounts[address];
    if (!a || typeof a.base64 !== 'string')
        return unsupported('Missing captured account: ' + address);
    return Buffer.from(a.base64, 'base64');
}
function put(accounts, address, data) {
    accounts[address] = { ...accounts[address], base64: data.toString('base64') };
}
function u64(value) {
    if (value < 0n || value > U64)
        unsupported('Reserve or fee exceeds u64 bounds.');
    return value;
}
function camel(value) {
    if (Array.isArray(value))
        return value.map(camel);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [
            k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()),
            camel(v),
        ]));
    return value;
}
function deltaBins(a, b, step) {
    if (a <= 0n || b <= 0n || step <= 0n)
        return unsupported('Invalid dynamic fee price/reference.');
    return ((((a > b ? a : b) << 64n) / (a > b ? b : a) - Q64) / step) * 2n;
}
function preSwap(p, time) {
    const d = p.poolFees.dynamicFee;
    if (!d.initialized)
        return;
    if (time < integer(d.lastUpdateTimestamp))
        unsupported('Clock regressed behind fee state.');
    const elapsed = time - integer(d.lastUpdateTimestamp);
    if (elapsed >= BigInt(d.filterPeriod)) {
        d.sqrtPriceReference = p.sqrtPrice;
        d.volatilityReference = bn(elapsed < BigInt(d.decayPeriod)
            ? (integer(d.volatilityAccumulator) * BigInt(d.reductionFactor)) / 10000n
            : 0n);
    }
}
function postSwap(p, previous, time) {
    const d = p.poolFees.dynamicFee;
    if (!d.initialized)
        return;
    const value = integer(d.volatilityReference) +
        deltaBins(integer(p.sqrtPrice), integer(d.sqrtPriceReference), integer(d.binStepU128)) * 10000n;
    d.volatilityAccumulator = bn(value < BigInt(d.maxVolatilityAccumulator) ? value : BigInt(d.maxVolatilityAccumulator));
    if (deltaBins(previous, integer(p.sqrtPrice), integer(d.binStepU128)) > 0n)
        d.lastUpdateTimestamp = bn(time);
}
function mintSupply(accounts, mint) {
    const a = accounts[mint];
    return unpackMint(new PublicKey(mint), {
        data: bytes(accounts, mint),
        owner: new PublicKey(a.owner),
        lamports: 0,
        executable: false,
        rentEpoch: 0,
    }, new PublicKey(a.owner)).supply;
}
function vaultDelta(accounts, address, delta, withheld = 0n) {
    const raw = bytes(accounts, address);
    raw.writeBigUInt64LE(u64(raw.readBigUInt64LE(64) + delta), 64);
    // Token-2022 transfer fees are withheld in the receiving vault's TransferFeeAmount extension.
    if (withheld) {
        let found = false;
        for (let offset = 166; offset + 4 <= raw.length;) {
            const type = raw.readUInt16LE(offset), length = raw.readUInt16LE(offset + 2);
            if (offset + 4 + length > raw.length)
                unsupported('Malformed vault TLV.');
            if (type === 2 && length === 8) {
                raw.writeBigUInt64LE(u64(raw.readBigUInt64LE(offset + 4) + withheld), offset + 4);
                found = true;
                break;
            }
            offset += 4 + length;
        }
        if (!found)
            unsupported('Receiving vault lacks transfer-fee withholding state.');
    }
    put(accounts, address, raw);
}
/** Initializes one caller-owned sandbox. No database, global cache, timer or RPC exists here. */
export function createSequentialSimulation(scope, states) {
    if (!scope.accountId || !scope.roundId || !states.length)
        unsupported('Missing simulation scope/routes.');
    const accounts = {}, routes = {};
    for (const state of states) {
        const s = snapshot(state);
        if (routes[state.identity.marketId])
            unsupported('Duplicate route identity.');
        for (const [address, account] of Object.entries(s.accounts)) {
            if (accounts[address] &&
                (accounts[address].owner !== account.owner || accounts[address].base64 !== account.base64))
                unsupported('External reconciliation required for conflicting snapshots: ' + address);
            accounts[address] = structuredClone(account);
        }
        routes[state.identity.marketId] = structuredClone(state);
    }
    return { scope: { ...scope }, sequence: 0, routes, accounts, residualAmounts: {} };
}
function routeState(simulation, scope, marketId) {
    if (scope.accountId !== simulation.scope.accountId || scope.roundId !== simulation.scope.roundId)
        unsupported('Account/round scope mismatch.');
    const route = simulation.routes[marketId];
    if (!route)
        return unsupported('Route is not present in this sandbox.');
    // Copy only the original capture's account addresses; every route sees shared pool/vault updates.
    const accounts = Object.fromEntries(Object.keys(snapshot(route).accounts).map((address) => [
        address,
        structuredClone(simulation.accounts[address]),
    ]));
    return {
        ...structuredClone(route),
        normalizedState: { ...structuredClone(route.normalizedState), accounts },
    };
}
export function previewSequentialRoute(simulation, scope, marketId, input, buy) {
    return guard(() => quoteRecordedRoute(routeState(simulation, scope, marketId), input, buy));
}
/** Adoption of returned `next` is the caller's explicit simulated commit; inputs never change. */
export function transitionSequentialRoute(simulation, scope, marketId, input, buy) {
    return guard(() => transition(simulation, scope, marketId, input, buy));
}
function transition(simulation, scope, marketId, input, buy) {
    const before = routeState(simulation, scope, marketId), state = structuredClone(before);
    const { hops, accounts } = snapshot(state);
    const clock = bytes(accounts, CLOCK);
    const time = clock.readBigInt64LE(32);
    if (time < 0n || clock.readBigUInt64LE(0) > state.chainSlot)
        unsupported('Invalid recorded Clock.');
    const quote = quoteRecordedRoute(state, input, buy); // Reuse all existing identity/fee/vault validation.
    const residualAmounts = { ...simulation.residualAmounts };
    if (quote.consumedInput !== input)
        unsupported('Partial-input transition is not implemented.');
    const ordered = buy ? [...hops].reverse() : hops;
    for (const [index, hop] of ordered.entries()) {
        const detail = quote.details[index];
        const value = (key) => {
            if (typeof detail[key] !== 'string' || !/^\d+$/.test(detail[key]))
                unsupported('Malformed hop quote: ' + key);
            return BigInt(detail[key]);
        };
        if (detail['pool'] !== hop.pool)
            unsupported('Quote and transition topology differ.');
        const aToB = detail['direction'] === 'A_TO_B', amount = value('inputAfterTransfer');
        let poolInput = amount, poolOutput = value('outputBeforeTransfer');
        if (hop.program === METEORA_DAMM_V2_PROGRAM) {
            const encoded = bytes(accounts, hop.pool);
            const raw = cpAmmCoder.accounts.decode('Pool', encoded);
            const p = camel(raw);
            if (p.layoutVersion !== 1 ||
                ![1, 2].includes(p.collectFeeMode) ||
                p.rewardInfos.some((r) => r.initialized))
                unsupported('Only layout-v1 OnlyB/Compounding DAMM without active rewards is implemented.');
            const old = integer(p.sqrtPrice);
            preSwap(p, time);
            const mode = getFeeMode(p.collectFeeMode, aToB ? 0 : 1, false);
            const q = getSwapResultFromExactInput(p, bn(amount), mode, aToB ? 0 : 1, bn(p.activationType === 0 ? state.chainSlot : time));
            if (!q.amountLeft.isZero() || integer(q.outputAmount) !== poolOutput)
                unsupported('SDK result and recorded route quote disagree.');
            const grossOut = q.outputAmount.add(mode.feesOnInput
                ? bn(0n)
                : q.claimingFee.add(q.compoundingFee).add(q.protocolFee).add(q.referralFee));
            if (aToB) {
                p.tokenAAmount = p.tokenAAmount.add(q.excludedFeeInputAmount);
                p.tokenBAmount = p.tokenBAmount.sub(grossOut);
            }
            else {
                p.tokenBAmount = p.tokenBAmount.add(q.excludedFeeInputAmount);
                p.tokenAAmount = p.tokenAAmount.sub(grossOut);
            }
            p.tokenBAmount = p.tokenBAmount.add(q.compoundingFee);
            u64(integer(p.tokenAAmount));
            u64(integer(p.tokenBAmount));
            p.sqrtPrice = q.nextSqrtPrice;
            postSwap(p, old, time);
            raw['token_a_amount'] = p.tokenAAmount;
            raw['token_b_amount'] = p.tokenBAmount;
            raw['sqrt_price'] = p.sqrtPrice;
            raw['protocol_b_fee'] = bn(u64(integer(p.protocolBFee) + integer(q.protocolFee)));
            const fees = raw['pool_fees'];
            const dynamic = fees['dynamic_fee'];
            for (const [key, value] of Object.entries(p.poolFees.dynamicFee))
                dynamic[key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())] = value;
            const feeGrowth = (integer(q.claimingFee) * (1n << 128n)) / integer(p.liquidity);
            const growth = Buffer.from(raw['fee_b_per_liquidity']);
            let cumulative = 0n;
            for (let i = 31; i >= 0; i--)
                cumulative = (cumulative << 8n) + BigInt(growth[i]);
            cumulative += feeGrowth;
            if (cumulative >= 1n << 256n)
                unsupported('Fee growth exceeds u256.');
            for (let i = 0; i < 32; i++) {
                growth[i] = Number(cumulative & 255n);
                cumulative >>= 8n;
            }
            raw['fee_b_per_liquidity'] = [...growth];
            const metrics = raw['metrics'];
            metrics['total_lp_b_fee'] = metrics['total_lp_b_fee'].add(q.claimingFee).add(q.compoundingFee);
            metrics['total_protocol_b_fee'] = bn(u64(integer(metrics['total_protocol_b_fee']) + integer(q.protocolFee)));
            // Anchor's public encode allocates 1000 bytes, smaller than this SDK's 1104-byte pool.
            // Use its existing layout, guarded by exact span; unknown codecs fail explicitly.
            const coder = cpAmmCoder.accounts;
            const layout = coder.accountLayouts.get('Pool')?.layout;
            if (!layout || layout.span !== 1104 || encoded.length !== 1112)
                return unsupported('Unknown DAMM pool codec.');
            layout.encode(raw, encoded.subarray(8));
            put(accounts, hop.pool, encoded);
        }
        else {
            const q = quoteSupplementalHop(hop, accounts, amount, aToB, time, mintSupply(accounts, hop.mintA), []);
            if (q.output !== poolOutput ||
                !('unusedQuoteInput' in q.detail) ||
                typeof q.detail.unusedQuoteInput !== 'string')
                return unsupported('Inconsistent Pump quote.');
            if (value('inputTransferFee') || value('outputTransferFee'))
                unsupported('Pump transfers with nonzero transfer fees are not implemented.');
            const unused = BigInt(q.detail.unusedQuoteInput);
            const fee = q.protocol + q.creator, raw = bytes(accounts, hop.pool);
            if (aToB) {
                poolOutput += fee;
                for (const offset of [8, 24])
                    raw.writeBigUInt64LE(u64(raw.readBigUInt64LE(offset) + amount), offset);
                for (const offset of [16, 32])
                    raw.writeBigUInt64LE(u64(raw.readBigUInt64LE(offset) - poolOutput), offset);
            }
            else {
                poolInput -= fee + unused;
                if (unused)
                    residualAmounts[hop.mintB] = (BigInt(residualAmounts[hop.mintB] ?? '0') + unused).toString();
                for (const offset of [8, 24])
                    raw.writeBigUInt64LE(u64(raw.readBigUInt64LE(offset) - poolOutput), offset);
                for (const offset of [16, 32])
                    raw.writeBigUInt64LE(u64(raw.readBigUInt64LE(offset) + poolInput), offset);
            }
            put(accounts, hop.pool, raw);
        }
        vaultDelta(accounts, aToB ? hop.vaultA : hop.vaultB, poolInput, value('inputTransferFee'));
        vaultDelta(accounts, aToB ? hop.vaultB : hop.vaultA, -poolOutput);
    }
    const nextAccounts = { ...structuredClone(simulation.accounts), ...accounts };
    const next = {
        ...structuredClone(simulation),
        sequence: simulation.sequence + 1,
        accounts: nextAccounts,
        residualAmounts,
    };
    const after = routeState(next, scope, marketId);
    return {
        next,
        quote,
        evidence: {
            model: 'ISOLATED_SEQUENTIAL_ROUTE_V1',
            scope: { ...scope },
            sequence: next.sequence,
            beforeFingerprint: createMarketStateEvidence(before).fingerprint,
            afterFingerprint: createMarketStateEvidence(after).fingerprint,
            sourceFingerprint: createMarketStateEvidence(simulation.routes[marketId]).fingerprint,
            side: buy ? 'BUY' : 'SELL',
            input: input.toString(),
            output: quote.output.toString(),
            hops: quote.details,
            fees: quote.fees,
            residualAmounts,
        },
    };
}
//# sourceMappingURL=sequential-route.js.map