import type { Network } from '@btc-vision/bitcoin';
import { isMainnet, isTestnet } from './networks.js';
import type { SpenderInfo, TokenInfo } from '../types/index.js';

// ─── Mainnet ─────────────────────────────────────────────────────────────────

const MAINNET_TOKENS: TokenInfo[] = [
  {
    address: '0x75bd98b086b71010448ec5722b6020ce1e0f2c09f5d680c84059db1295948cf8',
    name: 'MOTO',
    symbol: 'MOTO',
    decimals: 8,
  },
];

const MAINNET_SPENDERS: SpenderInfo[] = [
  {
    address: '0x035884f9ac2b6ae75d7778553e7d447899e9a82e247d7ced48f22aa102681e70',
    name: 'NativeSwap',
    description: 'OPNet native BTC↔token DEX',
  },
  {
    address: '0xaccca433aec3878ebc041cde2a1a2656f928cc404377ebd8339f0bf2cdd66cbe',
    name: 'Staking',
    description: 'MOTO staking contract',
  },
];

// ─── Testnet ──────────────────────────────────────────────────────────────────

const TESTNET_TOKENS: TokenInfo[] = [
  {
    address: 'opt1sqzkx6wm5acawl9m6nay2mjsm6wagv7gazcgtczds',
    name: 'MOTO',
    symbol: 'MOTO',
    decimals: 8,
  },
  {
    address: 'opt1sqp5gx9k0nrqph3sy3aeyzt673dz7ygtqxcfdqfle',
    name: 'PILL',
    symbol: 'PILL',
    decimals: 8,
  },
];
const TESTNET_SPENDERS: SpenderInfo[] = [
  {
    address: '0x0e6ff1f2d7db7556cb37729e3738f4dae82659b984b2621fab08e1111b1b937a',
    name: 'MotoSwap LP Router',
    description: 'MotoSwap add-liquidity / LP contract on OPNet Signet Testnet',
  },
  {
    address: '0x831ca1f8ebcc1925be9aa3a22fd3c5c4bf7d03a86c66c39194fef698acb886ae',
    name: 'MotoSwap Staking',
    description: 'MotoSwap staking contract on OPNet Signet Testnet',
  },
];

// ─── Regtest ──────────────────────────────────────────────────────────────────

const REGTEST_TOKENS: TokenInfo[] = [];
const REGTEST_SPENDERS: SpenderInfo[] = [];

// ─── Exports ─────────────────────────────────────────────────────────────────

export function getKnownTokens(network: Network): TokenInfo[] {
  if (isMainnet(network)) return MAINNET_TOKENS;
  if (isTestnet(network)) return TESTNET_TOKENS;
  return REGTEST_TOKENS;
}

export function getKnownSpenders(network: Network): SpenderInfo[] {
  if (isMainnet(network)) return MAINNET_SPENDERS;
  if (isTestnet(network)) return TESTNET_SPENDERS;
  return REGTEST_SPENDERS;
}
