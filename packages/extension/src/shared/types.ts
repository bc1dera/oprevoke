export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface SpenderInfo {
  address: string;
  name: string;
  description: string;
}

export type AllowanceStatus = 'idle' | 'revoking' | 'revoked' | 'error';

/** allowance is serialised as a string because JSON can't carry bigint */
export interface AllowanceEntry {
  id: string;
  token: TokenInfo;
  spender: SpenderInfo;
  allowance: string;
  status: AllowanceStatus;
  errorMessage?: string;
  txId?: string;
}

export type NetworkId = 'mainnet' | 'testnet';
