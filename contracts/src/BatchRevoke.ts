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
// Verified: matches the @method ABI in OP20.ts (bytes32,bytes32,address,uint256,uint64,bytes).
// ---------------------------------------------------------------------------
const DECREASE_BY_SIG_SELECTOR: Selector = encodeSelector(
    'decreaseAllowanceBySignature(bytes32,bytes32,address,uint256,uint64,bytes)',
);

// ML-DSA-87 (the largest OPNet signature scheme) produces ~4595 bytes.
// We cap at 8192 to accommodate any future scheme with headroom.
const MAX_SIGNATURE_BYTES: u32 = 8192;

// Fixed calldata bytes before the variable-length signature:
//   4  selector
//   32 ownerAddr   (ADDRESS_BYTE_LENGTH)
//   32 tweakedKey  (ADDRESS_BYTE_LENGTH)
//   32 spender     (ADDRESS_BYTE_LENGTH)
//   32 amount      (U256_BYTE_LENGTH)
//   8  deadline    (U64_BYTE_LENGTH)
//   4  sig-length prefix (U32_BYTE_LENGTH)
// = 144 bytes
const FIXED_CALLDATA_BYTES: u32 = 4 + ADDRESS_BYTE_LENGTH + ADDRESS_BYTE_LENGTH +
    ADDRESS_BYTE_LENGTH + U256_BYTE_LENGTH + U64_BYTE_LENGTH + 4;

// ---------------------------------------------------------------------------
// BatchRevoke
//
// A non-custodial OPNet contract that revokes multiple OP_20 token allowances
// in a single Bitcoin transaction using signed permits.
//
// HOW IT WORKS
// ─────────────
// Because OP_20.decreaseAllowance() uses Blockchain.tx.sender as the owner,
// a naive batch contract cannot revoke on behalf of users.  Instead, this
// contract uses decreaseAllowanceBySignature(), which accepts the owner's
// address + tweaked public key + an off-chain signature, so the token contract
// can verify the user actually authorised the decrease without the BatchRevoke
// contract ever holding or controlling user funds.
//
// FLOW
// ─────
// 1. Frontend collects (token, spender, currentAllowance) for each approval.
// 2. For each entry the wallet signs a permit message (via wallet.signPermit).
// 3. Frontend calls batchRevoke() on this contract, bundling all entries.
// 4. Contract loops and calls decreaseAllowanceBySignature() on every token.
//
// SECURITY PROPERTIES
// ────────────────────
// • Non-custodial: contract holds no funds, no state, and no approvals.
// • ReentrancyGuard (STANDARD): prevents any token callback from re-entering.
// • Atomic: a single failed sub-call reverts the entire batch.
// • Permit replay protection: enforced by the OP_20 nonce in each token.
// • Signature size bound: MAX_SIGNATURE_BYTES prevents memory exhaustion.
// • Address validation: zero-address tokens are rejected early.
// • Amount validation: zero-amount entries are rejected (no-op protection).
// • Max 50 entries per call to bound execution depth and WASM memory.
// ---------------------------------------------------------------------------
@final
export class BatchRevoke extends ReentrancyGuard {
    public constructor() {
        super();
    }

    public override onDeployment(_calldata: Calldata): void {
        // No initialisation needed — this contract holds no funds or state.
    }

    // onUpdate is declared on OP_NET (grandparent); AssemblyScript requires
    // the immediate parent to re-declare a method before `override` is valid.
    // ReentrancyGuard does not re-declare onUpdate, so we omit the keyword.
    public onUpdate(_calldata: Calldata): void {
        // No upgrade logic.
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
    //   count       u32      — number of entries that follow (1–50)
    //
    //   Repeated `count` times:
    //     token       address  — OP_20 token contract address (32 bytes)
    //     ownerAddr   bytes32  — owner's OPNet address bytes  (32 bytes)
    //     tweakedKey  bytes32  — owner's tweaked public key   (32 bytes)
    //     spender     address  — the spender being revoked    (32 bytes)
    //     amount      uint256  — allowance to subtract        (32 bytes, must be > 0)
    //     deadline    uint64   — permit expiry (Unix seconds) (8 bytes)
    //     signature   bytes    — length-prefixed permit sig   (4 + N bytes, N ≤ 8192)
    // -----------------------------------------------------------------------
    private batchRevoke(calldata: Calldata): BytesWriter {
        const count: u32 = calldata.readU32();
        if (count === 0) throw new Revert('BatchRevoke: empty list');
        if (count > 50) throw new Revert('BatchRevoke: max 50 entries per call');

        for (let i: u32 = 0; i < count; i++) {
            const token: Address = calldata.readAddress();

            // FIX-1: Reject zero-address tokens early to avoid undefined behaviour
            // in Blockchain.call() and to surface encoding bugs clearly.
            if (token === Address.zero()) {
                throw new Revert('BatchRevoke: zero-address token');
            }

            // readBytesArray returns u8[] (Array<u8>) — fixed-length raw bytes
            const ownerAddr: u8[] = calldata.readBytesArray(ADDRESS_BYTE_LENGTH);
            const tweakedKey: u8[] = calldata.readBytesArray(ADDRESS_BYTE_LENGTH);
            const spender: Address = calldata.readAddress();

            // FIX-2: Reject zero-address spender — would be a no-op in OP_20 and
            // indicates a frontend encoding error.
            if (spender === Address.zero()) {
                throw new Revert('BatchRevoke: zero-address spender');
            }

            const amount: u256 = calldata.readU256();

            // FIX-3: Reject zero-amount entries — subtracting 0 from an allowance
            // is a no-op in OP_20 (allowance unchanged, event emitted, fee wasted).
            if (amount.isZero()) {
                throw new Revert('BatchRevoke: zero amount');
            }

            const deadline: u64 = calldata.readU64();

            // readBytesWithLength returns Uint8Array — variable-length with u32 prefix
            const signature: Uint8Array = calldata.readBytesWithLength();

            // FIX-4: Bound signature size to prevent memory exhaustion.
            // ML-DSA-87 (largest OPNet scheme) is ~4595 bytes; cap at 8192.
            const sigLen: u32 = u32(signature.length);
            if (sigLen === 0) {
                throw new Revert('BatchRevoke: empty signature');
            }
            if (sigLen > MAX_SIGNATURE_BYTES) {
                throw new Revert('BatchRevoke: signature too large');
            }

            this._callDecreaseBySignature(
                token,
                ownerAddr,
                tweakedKey,
                spender,
                amount,
                deadline,
                signature,
                sigLen,
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
        ownerAddr: u8[],
        tweakedKey: u8[],
        spender: Address,
        amount: u256,
        deadline: u64,
        signature: Uint8Array,
        sigLen: u32,
    ): void {
        // FIX-5: Verify the total buffer size won't overflow u32 before allocating.
        // FIXED_CALLDATA_BYTES = 144; sigLen ≤ MAX_SIGNATURE_BYTES = 8192;
        // maximum total = 152 + 8192 = 8336 — well within u32 range, but we assert
        // the invariant explicitly for future maintainability.
        if (sigLen > MAX_SIGNATURE_BYTES) {
            throw new Revert('BatchRevoke: sigLen overflow guard');
        }
        const bufSize: u32 = FIXED_CALLDATA_BYTES + sigLen;

        const buf = new BytesWriter(bufSize);
        buf.writeSelector(DECREASE_BY_SIG_SELECTOR);
        // writeU8Array with be=false: write bytes in the order they were read
        // (already in the correct big-endian wire format from calldata).
        buf.writeU8Array(ownerAddr, false);
        buf.writeU8Array(tweakedKey, false);
        buf.writeAddress(spender);
        buf.writeU256(amount);
        buf.writeU64(deadline);
        buf.writeBytesWithLength(signature);

        // Blockchain.call defaults to stopExecutionOnFailure=true, so a sub-call
        // failure already reverts. We also check result.success explicitly for
        // belt-and-suspenders clarity and to provide a meaningful revert message.
        const result = Blockchain.call(token, buf);
        if (!result.success) {
            throw new Revert('BatchRevoke: sub-call failed — permit invalid or expired');
        }
    }
}
