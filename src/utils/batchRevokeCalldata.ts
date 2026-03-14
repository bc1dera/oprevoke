/**
 * Encodes calldata for the BatchRevoke contract's batchRevoke(uint32) method.
 *
 * Calldata layout (packed, big-endian, no padding):
 *   4 bytes:  selector  = first 4 bytes of sha256("batchRevoke(uint32)")
 *   4 bytes:  count     = number of entries (u32 BE)
 *   Per entry:
 *     32 bytes: token address (OP20 contract address bytes)
 *     32 bytes: ownerAddr    (owner's OPNet address bytes — raw, no length prefix)
 *     32 bytes: tweakedKey   (owner's tweaked x-only public key — raw)
 *     32 bytes: spender address bytes
 *     32 bytes: amount (u256 BE)
 *      8 bytes: deadline (u64 BE)
 *      4 bytes: signature length (u32 BE)
 *      N bytes: signature
 */

import { sha256 } from '@noble/hashes/sha2.js';

/** Compute selector: first 4 bytes of sha256(methodSignature). */
function selector(methodSig: string): Uint8Array {
  const encoded = new TextEncoder().encode(methodSig);
  return sha256(encoded).subarray(0, 4);
}

const BATCH_REVOKE_SELECTOR = selector('batchRevoke(uint32)');

export interface BatchRevokeEntry {
  /** 32-byte OP20 token contract address */
  token: Uint8Array;
  /** 32-byte owner OPNet address bytes */
  ownerAddr: Uint8Array;
  /** 32-byte owner tweaked x-only public key */
  tweakedKey: Uint8Array;
  /** 32-byte spender address bytes */
  spender: Uint8Array;
  /** allowance amount */
  amount: bigint;
  /** expiry block number */
  deadline: bigint;
  /** Schnorr signature bytes */
  signature: Uint8Array;
}

/** Write a bigint as a big-endian 32-byte array. */
function bigintToBytes32(value: bigint): Uint8Array {
  const result = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    result[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return result;
}

/** Write a bigint as a big-endian 8-byte array. */
function bigintToBytes8(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    result[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return result;
}

/** Write a u32 as 4 big-endian bytes into buf at offset. */
function writeU32(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
  view.setUint32(0, value, false);
}

/**
 * Encode the batchRevoke calldata.
 * @param entries - Array of permit entries to batch
 * @returns Raw calldata bytes for the batchRevoke call
 */
export function encodeBatchRevokeCalldata(entries: BatchRevokeEntry[]): Uint8Array {
  if (entries.length === 0) throw new Error('BatchRevoke: empty entries');
  if (entries.length > 50) throw new Error('BatchRevoke: max 50 entries');

  // Compute total size:
  // 4 (selector) + 4 (count) + per entry: 32+32+32+32+32+8+4+sigLen
  let totalSize = 8; // selector + count
  for (const e of entries) {
    totalSize += 32 + 32 + 32 + 32 + 32 + 8 + 4 + e.signature.length;
  }

  const buf = new Uint8Array(totalSize);
  let off = 0;

  // Selector
  buf.set(BATCH_REVOKE_SELECTOR, off);
  off += 4;

  // Count (u32 BE)
  writeU32(buf, off, entries.length);
  off += 4;

  for (const e of entries) {
    buf.set(e.token, off);
    off += 32;
    buf.set(e.ownerAddr, off);
    off += 32;
    buf.set(e.tweakedKey, off);
    off += 32;
    buf.set(e.spender, off);
    off += 32;
    buf.set(bigintToBytes32(e.amount), off);
    off += 32;
    buf.set(bigintToBytes8(e.deadline), off);
    off += 8;
    // Signature: u32 length prefix + raw bytes
    writeU32(buf, off, e.signature.length);
    off += 4;
    buf.set(e.signature, off);
    off += e.signature.length;
  }

  return buf;
}
