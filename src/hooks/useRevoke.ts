import { useCallback } from 'react';
import { Address } from '@btc-vision/transaction';
import { fromBech32 } from '@btc-vision/bitcoin';
import type { AbstractRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { contractService } from '../services/ContractService.js';

export function useRevoke() {
  /**
   * Revokes an OP20 allowance by calling decreaseAllowance(spender, currentAllowance).
   * This brings the spender's allowance to exactly 0.
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
      // Without it, decreaseAllowance reverts because the contract can't determine
      // who is calling.
      contract.setSender(userAddress);

      const spenderAddr = spenderAddress.startsWith('0x')
        ? Address.fromString(spenderAddress)
        : Address.wrap(fromBech32(spenderAddress).data);

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

  return { revoke };
}
