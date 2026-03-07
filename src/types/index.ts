export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  isCustom?: boolean;
}

export interface SpenderInfo {
  address: string;
  name: string;
  description: string;
}

export type AllowanceStatus = 'idle' | 'revoking' | 'revoked' | 'error';

export interface AllowanceEntry {
  /** Unique key: `${tokenAddress}:${spenderAddress}` */
  id: string;
  token: TokenInfo;
  spender: SpenderInfo;
  allowance: bigint;
  status: AllowanceStatus;
  errorMessage?: string;
}
