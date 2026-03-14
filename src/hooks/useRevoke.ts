import { useCallback } from 'react';
import { Address } from '@btc-vision/transaction';
import { fromBech32 } from '@btc-vision/bitcoin';
import type { AbstractRpcProvider } from 'opnet';
import type { UTXO } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { contractService } from '../services/ContractService.js';

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

  return { revoke, batchRevoke };
}
