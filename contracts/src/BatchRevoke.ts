import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    encodeSelector,
    ReentrancyGuard,
    Revert,
    Selector,
    ADDRESS_BYTE_LENGTH,
    U256_BYTE_LENGTH,
    U64_BYTE_LENGTH,
} from '@btc-vision/btc-runtime/runtime';

// ---------------------------------------------------------------------------
// Selector for the OP_20 decreaseAllowanceBySignature method.
// This must exactly match the selector used by the deployed OP_20 contracts.
// Verify with: sha256("decreaseAllowanceBySignature(bytes32,bytes32,address,uint256,uint64,bytes)")[0..4]
// ---------------------------------------------------------------------------
const DECREASE_BY_SIG_SELECTOR: Selector = encodeSelector(
    'decreaseAllowanceBySignature(bytes32,bytes32,address,uint256,uint64,bytes)',
);

// ---------------------------------------------------------------------------
// BatchRevoke
//
// A non-custodial OPNet contract that revokes multiple OP_20 token allowances
// in a single Bitcoin transaction using EIP-2612-style signed permits.
//
// HOW IT WORKS
// ─────────────
// Because OP_20.decreaseAllowance() uses Blockchain.tx.sender as the owner,
// a naive batch contract cannot revoke on behalf of users.  Instead, this
// contract uses decreaseAllowanceBySignature(), which accepts the owner's
// address + tweaked public key + an off-chain signature, so the token contract
// can verify the user actually authorised the decrease.
//
// FLOW
// ─────
// 1. Frontend collects (token, spender, currentAllowance) for each approval.
// 2. For each entry the wallet signs a permit message (via wallet.signPermit).
// 3. Frontend calls batchRevoke() on this contract, bundling all entries.
// 4. Contract loops and calls decreaseAllowanceBySignature() on every token.
//
// SECURITY
// ─────────
// • ReentrancyGuard (STANDARD) prevents any token callback from re-entering.
// • Deadline field lets users cap permit validity (use block.timestamp + 60s).
// • Max 50 entries per call to bound gas / execution depth.
// • Each failed sub-call reverts the entire batch (atomic).
// ---------------------------------------------------------------------------
@final
export class BatchRevoke extends ReentrancyGuard {
    public constructor() {
        super();
    }

    public override onDeployment(_calldata: Calldata): void {
        // No initialisation needed — this contract holds no funds or state.
    }

    public override onUpdate(_calldata: Calldata): void {
        // No upgrade logic needed.
    }

    public override execute(method: Selector, calldata: Calldata): BytesWriter {
        switch (method) {
            case encodeSelector('batchRevoke(uint32)'):
                return this.batchRevoke(calldata);
            default:
                return super.execute(method, calldata);
        }
    }

    // -----------------------------------------------------------------------
    // batchRevoke
    //
    // Calldata layout (all values big-endian, packed, no padding):
    //   count       u32      — number of entries that follow
    //
    //   Repeated `count` times:
    //     token       address  — OP_20 token contract address (32 bytes)
    //     ownerAddr   bytes32  — owner's OPNet address bytes  (32 bytes)
    //     tweakedKey  bytes32  — owner's tweaked public key   (32 bytes)
    //     spender     address  — the spender being revoked    (32 bytes)
    //     amount      uint256  — allowance to subtract        (32 bytes)
    //     deadline    uint64   — permit expiry timestamp      (8 bytes)
    //     signature   bytes    — length-prefixed permit sig   (4 + N bytes)
    // -----------------------------------------------------------------------
    private batchRevoke(calldata: Calldata): BytesWriter {
        const count: u32 = calldata.readU32();
        if (count === 0) throw new Revert('BatchRevoke: empty list');
        if (count > 50) throw new Revert('BatchRevoke: max 50 entries per call');

        for (let i: u32 = 0; i < count; i++) {
            const token: Address = calldata.readAddress();
            const ownerAddr: Uint8Array = calldata.readBytesArray(ADDRESS_BYTE_LENGTH);
            const tweakedKey: Uint8Array = calldata.readBytesArray(ADDRESS_BYTE_LENGTH);
            const spender: Address = calldata.readAddress();
            const amount: u256 = calldata.readU256();
            const deadline: u64 = calldata.readU64();
            const signature: Uint8Array = calldata.readBytesWithLength();

            this._callDecreaseBySignature(
                token,
                ownerAddr,
                tweakedKey,
                spender,
                amount,
                deadline,
                signature,
            );
        }

        // Return a single success boolean for the caller to assert.
        const out = new BytesWriter(1);
        out.writeBoolean(true);
        return out;
    }

    // -----------------------------------------------------------------------
    // _callDecreaseBySignature
    // Encodes and dispatches a single decreaseAllowanceBySignature cross-call.
    // -----------------------------------------------------------------------
    private _callDecreaseBySignature(
        token: Address,
        ownerAddr: Uint8Array,
        tweakedKey: Uint8Array,
        spender: Address,
        amount: u256,
        deadline: u64,
        signature: Uint8Array,
    ): void {
        const sigLen: u32 = u32(signature.length);

        // Byte budget:
        //   4  selector
        //   32 ownerAddr   (ADDRESS_BYTE_LENGTH)
        //   32 tweakedKey  (ADDRESS_BYTE_LENGTH)
        //   32 spender     (ADDRESS_BYTE_LENGTH)
        //   32 amount      (U256_BYTE_LENGTH)
        //   8  deadline    (U64_BYTE_LENGTH)
        //   4  sigLen u32 prefix
        //   N  signature bytes
        const bufSize: u32 =
            4 +
            ADDRESS_BYTE_LENGTH +
            ADDRESS_BYTE_LENGTH +
            ADDRESS_BYTE_LENGTH +
            U256_BYTE_LENGTH +
            U64_BYTE_LENGTH +
            4 +
            sigLen;

        const buf = new BytesWriter(bufSize);
        buf.writeSelector(DECREASE_BY_SIG_SELECTOR);
        buf.writeBytes(ownerAddr);
        buf.writeBytes(tweakedKey);
        buf.writeAddress(spender);
        buf.writeU256(amount);
        buf.writeU64(deadline);
        buf.writeBytesWithLength(signature);

        const result = Blockchain.call(token, buf);
        if (!result || result.revert) {
            throw new Revert('BatchRevoke: sub-call failed — permit invalid or expired');
        }
    }
}
