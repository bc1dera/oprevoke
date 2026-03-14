/**
 * OP-712 permit message construction for OP20 decreaseAllowanceBySignature.
 *
 * OPNet uses SHA256 throughout (not keccak256).
 *
 * Permit message layout:
 *   structHash = sha256(
 *     ALLOWANCE_DECREASE_TYPE_HASH (32)
 *     || ownerAddress (32)
 *     || spenderAddress (32)
 *     || amount as u256 BE (32)
 *     || nonce as u256 BE (32)
 *     || deadline as u64 BE (8)
 *   )
 *   message = sha256(0x1901 (2) || domainSeparator (32) || structHash (32))
 *
 * The domain separator is fetched directly from the OP20 contract
 * (contract.domainSeparator()) so we don't need to recompute it here.
 */

import { sha256 } from '@noble/hashes/sha2.js';

/**
 * sha256(
 *   "AllowanceDecrease(bytes32 owner,address spender,uint256 value,uint256 nonce,uint64 deadline)"
 * )
 * Verified against btc-runtime source.
 */
const ALLOWANCE_DECREASE_TYPE_HASH = new Uint8Array([
  0x70, 0x87, 0x99, 0x34, 0x92, 0x1c, 0x2f, 0x48, 0x17, 0x78, 0x87, 0x89,
  0x77, 0xd5, 0xb4, 0x5e, 0x2a, 0x59, 0xda, 0x1d, 0x28, 0x22, 0x41, 0xc9,
  0x3f, 0xf1, 0xba, 0x6a, 0xf0, 0x98, 0xfc, 0xd0,
]);

/** Write a bigint as a big-endian 32-byte array (u256). */
function bigintToBytes32(value: bigint): Uint8Array {
  const result = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    result[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return result;
}

/** Write a bigint as a big-endian 8-byte array (u64). */
function bigintToBytes8(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    result[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return result;
}

/**
 * Build the OP-712 permit message hash for decreaseAllowanceBySignature.
 *
 * @param domainSeparator  - 32-byte domain separator from contract.domainSeparator()
 * @param ownerAddress     - 32-byte owner address bytes (address.toBuffer())
 * @param spenderAddress   - 32-byte spender address bytes (spenderAddr.toBuffer())
 * @param amount           - allowance decrease amount
 * @param nonce            - owner's current nonce from contract.nonceOf()
 * @param deadline         - expiry block number
 * @returns 32-byte message hash to sign
 */
export function buildPermitHash(
  domainSeparator: Uint8Array,
  ownerAddress: Uint8Array,
  spenderAddress: Uint8Array,
  amount: bigint,
  nonce: bigint,
  deadline: bigint,
): Uint8Array {
  // --- struct hash ---
  // Layout: typeHash(32) || owner(32) || spender(32) || amount(32) || nonce(32) || deadline(8)
  const structInput = new Uint8Array(32 + 32 + 32 + 32 + 32 + 8);
  let offset = 0;
  structInput.set(ALLOWANCE_DECREASE_TYPE_HASH, offset);
  offset += 32;
  structInput.set(ownerAddress, offset);
  offset += 32;
  structInput.set(spenderAddress, offset);
  offset += 32;
  structInput.set(bigintToBytes32(amount), offset);
  offset += 32;
  structInput.set(bigintToBytes32(nonce), offset);
  offset += 32;
  structInput.set(bigintToBytes8(deadline), offset);

  const structHash = sha256(structInput);

  // --- message hash ---
  // Layout: 0x1901 (2) || domainSeparator(32) || structHash(32)
  const msgInput = new Uint8Array(2 + 32 + 32);
  msgInput[0] = 0x19;
  msgInput[1] = 0x01;
  msgInput.set(domainSeparator, 2);
  msgInput.set(structHash, 34);

  return sha256(msgInput);
}
