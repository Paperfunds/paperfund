import { PublicKey } from '@solana/web3.js';
import { unpackMint } from '@solana/spl-token';
import { SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from './pump-fun.js';
/** Read display supply from the same immutable chain evidence as the execution. */
export function chartMintSupply(state, mint) {
    if (!state)
        return null;
    const supply = state['mintSupply'];
    if (typeof supply === 'string' && /^[1-9]\d*$/.test(supply))
        return supply;
    const accounts = state['accounts'];
    const account = accounts?.[mint];
    if (!account || ![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(account.owner))
        return null;
    try {
        const info = unpackMint(new PublicKey(mint), {
            owner: new PublicKey(account.owner),
            data: Buffer.from(account.base64, 'base64'),
            executable: false,
            lamports: 0,
            rentEpoch: 0,
        }, new PublicKey(account.owner));
        return info.isInitialized && info.supply > 0n ? info.supply.toString() : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=chart-supply.js.map