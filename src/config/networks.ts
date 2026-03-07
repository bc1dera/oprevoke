import { networks, type Network } from '@btc-vision/bitcoin';

export interface NetworkConfig {
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  mempoolUrl: string;
}

// Compare by bech32 prefix — wallet may return a different object reference
// than the constants in @btc-vision/bitcoin, so === would fail.
export function isMainnet(n: Network): boolean {
  return n.bech32 === networks.bitcoin.bech32;
}

export function isTestnet(n: Network): boolean {
  return n.bech32 === networks.opnetTestnet.bech32;
}

export function isRegtest(n: Network): boolean {
  return n.bech32 === networks.regtest.bech32;
}

export function getNetworkConfig(network: Network): NetworkConfig {
  if (isMainnet(network)) {
    return {
      name: 'Mainnet',
      rpcUrl: 'https://mainnet.opnet.org',
      explorerUrl: 'https://explorer.opnet.org',
      mempoolUrl: 'https://mempool.space/tx/',
    };
  }
  if (isTestnet(network)) {
    return {
      name: 'OPNet Testnet',
      rpcUrl: 'https://testnet.opnet.org',
      explorerUrl: 'https://testnet-explorer.opnet.org',
      mempoolUrl: 'https://testnet.opnet.org/tx/',
    };
  }
  if (isRegtest(network)) {
    return {
      name: 'Regtest',
      rpcUrl: 'http://localhost:9001',
      explorerUrl: 'http://localhost:3000',
      mempoolUrl: 'http://localhost:3000/tx/',
    };
  }
  return {
    name: 'Unknown',
    rpcUrl: 'https://mainnet.opnet.org',
    explorerUrl: 'https://explorer.opnet.org',
    mempoolUrl: 'https://mempool.space/tx/',
  };
}
