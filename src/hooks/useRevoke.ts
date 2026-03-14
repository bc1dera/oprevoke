import { useCallback } from 'react';
import { Address, SignatureType } from '@btc-vision/transaction';
import { fromBech32 } from '@btc-vision/bitcoin';
import type { AbstractRpcProvider } from 'opnet';
import type { UTXO } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import type { Unisat } from '@btc-vision/transaction';
import { contractService } from '../services/ContractService.js';
import { getBatchRevokeContract } from '../config/contracts.js';
import { buildPermitHash } from '../utils/op712.js';
import {
  encodeBatchRevokeCalldata,
  type BatchRevokeEntry as BatchRevokeCalldataEntry,
} from '../utils/batchRevokeCalldata.js';

export interface BatchRevokeEntry {
  id: string;
  tokenAddress: string;
  spenderAddress: string;
  currentAllowance: bigint;
}

function parseSpender(spenderAddress: string): Address {
  return spenderAddress.startsWith('0x')
    ? Address.fromString(spenderAddress)
    : Address.wrap(fromBech32(spenderAddress).data);
}

export function useRevoke() {
  /**
   * Revokes a single OP20 allowance by calling decreaseAllowance(spender, currentAllowance).
   *
   * FRONTEND RULES:
   * - signer: null, mldsaSigner: null — wallet handles signing
   * - Always simulate before sending
   * - Never construct raw PSBTs
   */
  const revoke = useCallback(
    async (
      tokenAddress: string,
      spenderAddress: string,
      currentAllowance: bigint,
      refundTo: string,
      userAddress: Address,
      provider: AbstractRpcProvider,
      network: Network,
    ): Promise<string> => {
      const contract = contractService.getTokenContract(tokenAddress, provider, network);

      // setSender is required so the simulation knows msg.sender (the owner).
      contract.setSender(userAddress);

      const spenderAddr = parseSpender(spenderAddress);

      // Step 1: Simulate
      const simulation = await contract.decreaseAllowance(spenderAddr, currentAllowance);

      if (simulation.revert) {
        throw new Error(`Simulation reverted: ${simulation.revert}`);
      }

      // Step 2: Send — signer/mldsaSigner MUST be null on frontend; wallet signs
      const receipt = await simulation.sendTransaction({
        signer: null,
        mldsaSigner: null,
        refundTo,
        feeRate: 10,
        network,
        maximumAllowedSatToSpend: 10000n,
      });

      return receipt.transactionId;
    },
    [],
  );

  /**
   * Revokes multiple OP20 allowances in rapid succession using UTXO chaining.
   *
   * Each transaction's change outputs are fed as inputs to the next transaction,
   * so all revocations can be submitted without waiting for block confirmations.
   * The wallet still signs each transaction individually, but they chain together
   * efficiently.
   *
   * If any single revocation fails, the chain resets (next tx sources fresh UTXOs
   * from the wallet) and processing continues with the remaining entries.
   */
  const batchRevoke = useCallback(
    async (
      entries: BatchRevokeEntry[],
      refundTo: string,
      userAddress: Address,
      provider: AbstractRpcProvider,
      network: Network,
      onSuccess: (id: string, txId: string) => void,
      onError: (id: string, message: string) => void,
    ): Promise<void> => {
      // UTXOs from the previous transaction's change outputs.
      // undefined = let the wallet select UTXOs (first tx or after an error).
      let chainedUTXOs: UTXO[] | undefined = undefined;

      for (const entry of entries) {
        const { id, tokenAddress, spenderAddress, currentAllowance } = entry;
        try {
          const contract = contractService.getTokenContract(tokenAddress, provider, network);
          contract.setSender(userAddress);

          const spenderAddr = parseSpender(spenderAddress);

          const simulation = await contract.decreaseAllowance(spenderAddr, currentAllowance);

          if (simulation.revert) {
            throw new Error(`Simulation reverted: ${simulation.revert}`);
          }

          const receipt = await simulation.sendTransaction({
            signer: null,
            mldsaSigner: null,
            refundTo,
            feeRate: 10,
            network,
            maximumAllowedSatToSpend: 10000n,
            // Pass chained UTXOs so the next tx can spend the change output
            // from this tx without waiting for confirmation.
            utxos: chainedUTXOs,
          });

          // Propagate change outputs to the next iteration
          chainedUTXOs = receipt.newUTXOs.length > 0 ? receipt.newUTXOs : undefined;

          onSuccess(id, receipt.transactionId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          onError(id, msg);
          // Reset chain so the next revocation sources fresh UTXOs
          chainedUTXOs = undefined;
        }
      }
    },
    [],
  );

  /**
   * Revokes multiple OP20 allowances in a SINGLE Bitcoin transaction using the
   * deployed BatchRevoke contract and permit-based signatures (OP-712).
   *
   * Flow per entry:
   *   1. Fetch domainSeparator and nonceOf from the OP20 token.
   *   2. Build the OP-712 permit hash (sha256-based, not keccak256).
   *   3. Sign it via walletInstance.signData (Schnorr).
   *   4. Bundle all signed entries into one batchRevoke calldata.
   *   5. Simulate via provider.call, then sendTransaction — one Bitcoin tx.
   *
   * Falls back to regular batchRevoke (UTXO-chain) if no BatchRevoke contract
   * is deployed on the current network.
   */
  const contractBatchRevoke = useCallback(
    async (
      entries: BatchRevokeEntry[],
      refundTo: string,
      userAddress: Address,
      provider: AbstractRpcProvider,
      network: Network,
      walletInstance: Unisat,
      onSuccess: (ids: string[], txId: string) => void,
      onError: (ids: string[], message: string) => void,
    ): Promise<void> => {
      const batchRevokeAddr = getBatchRevokeContract(network);
      if (!batchRevokeAddr) {
        throw new Error('BatchRevoke contract not deployed on this network');
      }

      const ids: string[] = entries.map((e) => e.id);

      try {
        // Current block used to compute deadline (block number + buffer).
        const currentBlock = await provider.getBlockNumber();
        // Give 30 blocks (~5 min at ~10s/block) for the tx to confirm.
        const deadline = currentBlock + 30n;

        // 32-byte owner bytes (SHA256 of MLDSA public key = OPNet address content).
        const ownerAddrBytes = userAddress.toBuffer();
        // 32-byte tweaked x-only public key (for signature verification in OP20).
        const tweakedKeyBytes = userAddress.tweakedPublicKeyToBuffer();

        const calldataEntries: BatchRevokeCalldataEntry[] = [];

        for (const entry of entries) {
          const { tokenAddress, spenderAddress, currentAllowance } = entry;

          const contract = contractService.getTokenContract(tokenAddress, provider, network);

          // Fetch domain separator and owner nonce in parallel.
          const [dsResult, nonceResult] = await Promise.all([
            contract.domainSeparator(),
            contract.nonceOf(userAddress),
          ]);

          if (dsResult.revert) throw new Error(`domainSeparator reverted: ${dsResult.revert}`);
          if (nonceResult.revert) throw new Error(`nonceOf reverted: ${nonceResult.revert}`);

          const domainSeparator = dsResult.properties.domainSeparator;
          const nonce = nonceResult.properties.nonce;

          const spenderAddr = parseSpender(spenderAddress);
          const spenderBytes = spenderAddr.toBuffer();
          const tokenBytes = parseSpender(tokenAddress).toBuffer();

          // Build OP-712 permit hash.
          const msgHash = buildPermitHash(
            domainSeparator,
            ownerAddrBytes,
            spenderBytes,
            currentAllowance,
            nonce,
            deadline,
          );

          // Sign with Schnorr — walletInstance.signData takes hex string, returns hex sig.
          const msgHex = Buffer.from(msgHash).toString('hex');
          const sigHex = await walletInstance.signData(msgHex, SignatureType.schnorr);
          const signature = Uint8Array.from(Buffer.from(sigHex, 'hex'));

          calldataEntries.push({
            token: tokenBytes,
            ownerAddr: ownerAddrBytes,
            tweakedKey: tweakedKeyBytes,
            spender: spenderBytes,
            amount: currentAllowance,
            deadline,
            signature,
          });
        }

        // Encode the batchRevoke calldata.
        const calldata = encodeBatchRevokeCalldata(calldataEntries);

        // provider.call() returns a bare CallResult that is missing the `calldata`,
        // `to`, and `address` fields that sendTransaction() requires.
        // We must set them manually before calling sendTransaction.
        const batchRevokeAddrObj = parseSpender(batchRevokeAddr);

        // Simulate via provider.call.
        const callResult = await provider.call(batchRevokeAddr, calldata, userAddress);

        // Check for RPC-level error (ICallRequestError has an `error` field).
        if ('error' in callResult) {
          throw new Error(`BatchRevoke simulation failed: ${callResult.error}`);
        }

        if (callResult.revert) {
          throw new Error(`BatchRevoke simulation reverted: ${callResult.revert}`);
        }

        // Populate the fields that sendTransaction requires but provider.call doesn't set.
        callResult.setCalldata(calldata);
        callResult.setTo(batchRevokeAddr, batchRevokeAddrObj);

        // Send the single transaction.
        const receipt = await callResult.sendTransaction({
          signer: null,
          mldsaSigner: null,
          refundTo,
          feeRate: 10,
          network,
          maximumAllowedSatToSpend: 10000n,
        });

        onSuccess(ids, receipt.transactionId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        onError(ids, msg);
      }
    },
    [],
  );

  return { revoke, batchRevoke, contractBatchRevoke };
}
