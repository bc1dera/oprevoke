import { networks, type Network } from '@btc-vision/bitcoin';
import type { NetworkId } from './types.js';

export function networkFromId(id: NetworkId): Network {
  return id === 'mainnet' ? networks.bitcoin : networks.opnetTestnet;
}

export function rpcUrlFromId(id: NetworkId): string {
  return id === 'mainnet'
    ? 'https://mainnet.opnet.org'
    : 'https://testnet.opnet.org';
}

export function isMainnet(n: Network): boolean {
  return n.bech32 === networks.bitcoin.bech32;
}

export function isTestnet(n: Network): boolean {
  return n.bech32 === networks.opnetTestnet.bech32;
}
