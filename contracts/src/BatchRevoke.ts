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
// Verified against the @method ABI decorator in OP20.ts.
// ---------------------------------------------------------------------------
const DECREASE_BY_SIG_SELECTOR: Selector = encodeSelector(
    'decreaseAllowanceBySignature(bytes32,bytes32,address,uint256,uint64,bytes)',
);

// OP_20._verifySignature checks signature.length === 64 for the current
// Schnorr/ECDSA scheme. ML-DSA-87 (OPNet post-quantum) peaks at ~4595 bytes.
// We bound at 8192 to accommodate both and prevent memory-exhaustion DoS.
const MAX_SIGNATURE_BYTES: u32 = 8192;

// Fixed calldata bytes ahead of the variable-length signature:
//   4  selector
//   32 ownerAddr   (ADDRESS_BYTE_LENGTH)    — raw bytes, no length prefix
//   32 tweakedKey  (ADDRESS_BYTE_LENGTH)    — raw bytes, no length prefix
//   32 spender     (ADDRESS_BYTE_LENGTH)
//   32 amount      (U256_BYTE_LENGTH)
//   8  deadline    (U64_BYTE_LENGTH)
//   4  sig-length  u32 prefix
// = 144 bytes
const FIXED_CALLDATA_BYTES: u32 =
    4 +
    ADDRESS_BYTE_LENGTH +
    ADDRESS_BYTE_LENGTH +
    ADDRESS_BYTE_LENGTH +
    U256_BYTE_LENGTH +
    U64_BYTE_LENGTH +
    4;

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
// can verify the user actually authorised the decrease — without BatchRevoke
// ever holding or controlling user funds.
//
// FLOW
// ─────
// 1. Frontend collects (token, spender, currentAllowance) for each approval.
// 2. For each entry the wallet signs a permit message (via wallet.signPermit).
// 3. Frontend calls batchRevoke() on this contract, bundling all entries.
// 4. Contract pre-validates each entry, then calls decreaseAllowanceBySignature()
//    on every token. One failed sub-call reverts the entire batch.
//
// SECURITY PROPERTIES
// ────────────────────
// • Non-custodial: contract holds no funds, no state, and no approvals.
// • ReentrancyGuard (STANDARD): prevents any token callback from re-entering.
// • Atomic: a single failed sub-call reverts the entire batch.
// • Permit replay protection: enforced by the OP_20 nonce in each token.
// • Signature size bound: MAX_SIGNATURE_BYTES prevents memory-exhaustion DoS.
// • Address validation: zero and self-address tokens/spenders are rejected.
// • Amount validation: zero-amount entries are rejected (nonce-waste prevention).
// • Deadline validation: expired permits are rejected before making sub-calls.
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

    // onUpdate is declared on OP_NET (grandparent); AssemblyScript requires the
    // immediate parent to re-declare a method before `override` is valid.
    // ReentrancyGuard does not re-declare onUpdate so we omit the keyword.
    // Defence-in-depth: guard with onlyDeployer in case a future base-class
    // version of onUpdate adds upgrade logic that must not be bypassed.
    public onUpdate(_calldata: Calldata): void {
        this.onlyDeployer(Blockchain.tx.sender);
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
    //     ownerAddr   bytes32  — owner's OPNet address bytes  (32 bytes, raw)
    //     tweakedKey  bytes32  — owner's tweaked public key   (32 bytes, raw)
    //     spender     address  — the spender being revoked    (32 bytes)
    //     amount      uint256  — allowance to subtract        (32 bytes, must be > 0)
    //     deadline    uint64   — permit expiry block number   (8 bytes, must be >= current)
    //     signature   bytes    — length-prefixed permit sig   (4 + N bytes, N ≤ 8192)
    //
    // NOTE: deadline is a BLOCK NUMBER (Blockchain.block.number), not a Unix
    // timestamp. The frontend must use current block + N blocks, not Date.now().
    // -----------------------------------------------------------------------
    private batchRevoke(calldata: Calldata): BytesWriter {
        const count: u32 = calldata.readU32();
        if (count === 0) throw new Revert('BatchRevoke: empty list');
        if (count > 50) throw new Revert('BatchRevoke: max 50 entries per call');

        for (let i: u32 = 0; i < count; i++) {
            const token: Address = calldata.readAddress();

            // Reject zero-address and self-address tokens early.
            if (token === Address.zero()) {
                throw new Revert('BatchRevoke: zero-address token');
            }
            if (token === Blockchain.contractAddress) {
                throw new Revert('BatchRevoke: self-call token');
            }

            // readBytesArray returns u8[] (Array<u8>) — fixed-length, no wire prefix.
            const ownerAddr: u8[] = calldata.readBytesArray(ADDRESS_BYTE_LENGTH);
            const tweakedKey: u8[] = calldata.readBytesArray(ADDRESS_BYTE_LENGTH);

            const spender: Address = calldata.readAddress();
            if (spender === Address.zero()) {
                throw new Revert('BatchRevoke: zero-address spender');
            }

            const amount: u256 = calldata.readU256();
            if (amount.isZero()) {
                throw new Revert('BatchRevoke: zero amount — would waste permit nonce');
            }

            const deadline: u64 = calldata.readU64();
            // Deadline is a block number, not a timestamp.
            if (deadline < Blockchain.block.number) {
                throw new Revert('BatchRevoke: permit expired');
            }

            // readBytesWithLength returns Uint8Array — variable-length with u32 prefix.
            const signature: Uint8Array = calldata.readBytesWithLength();
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
        // sigLen ≤ MAX_SIGNATURE_BYTES = 8192; FIXED_CALLDATA_BYTES = 144.
        // Maximum bufSize = 144 + 8192 = 8336 — no u32 overflow possible.
        const bufSize: u32 = FIXED_CALLDATA_BYTES + sigLen;

        const buf = new BytesWriter(bufSize);
        buf.writeSelector(DECREASE_BY_SIG_SELECTOR);

        // CRITICAL FIX: use writeBytesU8Array (raw bytes, no length prefix) not
        // writeU8Array (which prepends a 2-byte u16 length header).
        //
        // OP_20.decreaseAllowanceBySignature reads these fields with:
        //   calldata.readBytesArray(ADDRESS_BYTE_LENGTH)  ← fixed-length, no prefix
        //
        // writeU8Array would have emitted [u16 len][bytes], causing:
        //   (a) bufSize underallocation by 4 bytes → BytesWriter revert on every call
        //   (b) wire-format mismatch → signature verification failure in OP_20
        buf.writeBytesU8Array(ownerAddr);
        buf.writeBytesU8Array(tweakedKey);
        buf.writeAddress(spender);
        buf.writeU256(amount);
        buf.writeU64(deadline);
        buf.writeBytesWithLength(signature);

        // Pass stopExecutionOnFailure=false so that when the sub-call fails our
        // own Revert message is surfaced rather than the host's generic revert.
        const result = Blockchain.call(token, buf, false);
        if (!result.success) {
            throw new Revert('BatchRevoke: sub-call failed — permit invalid, expired, or nonce mismatch');
        }
    }
}
