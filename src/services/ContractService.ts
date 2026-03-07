import { getContract, IOP20Contract, OP_20_ABI } from 'opnet';
import type { AbstractRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { isMainnet, isTestnet, isRegtest } from '../config/networks.js';

/**
 * Singleton cache for OP20 contract instances.
 * NEVER create multiple instances of the same contract — cache and reuse.
 * CRITICAL: keyed by string, NOT Address objects (Map uses reference equality).
 */
class ContractService {
  private static _instance: ContractService;
  private readonly contracts = new Map<string, IOP20Contract>();

  private constructor() {}

  static getInstance(): ContractService {
    if (!ContractService._instance) {
      ContractService._instance = new ContractService();
    }
    return ContractService._instance;
  }

  getTokenContract(
    address: string,
    provider: AbstractRpcProvider,
    network: Network,
  ): IOP20Contract {
    const key = `${this.networkId(network)}:${address.toLowerCase()}`;
    if (!this.contracts.has(key)) {
      const contract = getContract<IOP20Contract>(address, OP_20_ABI, provider, network);
      this.contracts.set(key, contract);
    }
    return this.contracts.get(key)!;
  }

  /** Call on wallet network change to avoid stale providers. */
  clearCache(): void {
    this.contracts.clear();
  }

  private networkId(network: Network): string {
    if (isMainnet(network)) return 'mainnet';
    if (isTestnet(network)) return 'testnet';
    if (isRegtest(network)) return 'regtest';
    return 'unknown';
  }
}

export const contractService = ContractService.getInstance();
