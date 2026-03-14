import type { AllowanceEntry, NetworkId } from './types.js';

// ── Outbound (popup/content → background) ────────────────────────────────────

export interface ScanAllowancesMsg {
  type: 'SCAN_ALLOWANCES';
  address: string;
  networkId: NetworkId;
}

export interface CheckPhishingMsg {
  type: 'CHECK_PHISHING';
  domain: string;
}

export interface RefreshBlocklistMsg {
  type: 'REFRESH_BLOCKLIST';
}

export interface TxInterceptedMsg {
  type: 'TX_INTERCEPTED';
  method: string;
  /** JSON-serialised (bigints stringified) tx args */
  args: unknown[];
}

export interface TokenCheckMsg {
  type: 'TOKEN_CHECK';
  tokenAddress: string;
}

export type ExtensionMessage =
  | ScanAllowancesMsg
  | CheckPhishingMsg
  | RefreshBlocklistMsg
  | TxInterceptedMsg
  | TokenCheckMsg;

// ── Response shapes ────────────────────────────────────────────────────────

export interface ScanAllowancesResponse {
  entries: AllowanceEntry[];
  error?: string;
}

export interface CheckPhishingResponse {
  isPhishing: boolean;
  reason?: string;
}

export interface TxCheckResponse {
  isRisky: boolean;
  warnings: string[];
}

export interface TokenCheckResponse {
  malicious: boolean;
  honeypot: boolean;
}
