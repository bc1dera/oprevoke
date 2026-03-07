import type { Network } from '@btc-vision/bitcoin';
import { getKnownTokens } from '../config/contracts.js';
import { isMainnet, isTestnet } from '../config/networks.js';
import type { TokenInfo } from '../types/index.js';

interface ApiToken {
  address?: string;
  contractAddress?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
}

function parseTokenList(data: unknown): ApiToken[] {
  if (Array.isArray(data)) return data as ApiToken[];
  if (data !== null && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['tokens', 'data', 'contracts', 'results', 'items']) {
      if (Array.isArray(obj[key])) return obj[key] as ApiToken[];
    }
  }
  return [];
}

async function fetchFromExplorer(explorerUrl: string): Promise<ApiToken[]> {
  const endpoints = [
    `${explorerUrl}/api/v1/tokens?limit=200`,
    `${explorerUrl}/api/tokens?limit=200`,
    `${explorerUrl}/api/v1/contracts?type=OP20&limit=200`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const json: unknown = await res.json();
      const list = parseTokenList(json);
      if (list.length > 0) return list;
    } catch {
      // try next endpoint
    }
  }
  return [];
}

export async function discoverTokens(network: Network): Promise<TokenInfo[]> {
  const hardcoded = getKnownTokens(network);

  let explorerUrl: string;
  if (isMainnet(network)) {
    explorerUrl = 'https://explorer.opnet.org';
  } else if (isTestnet(network)) {
    explorerUrl = 'https://testnet-explorer.opnet.org';
  } else {
    // Regtest — no public explorer, use hardcoded only
    return hardcoded;
  }

  const fetched = await fetchFromExplorer(explorerUrl);
  if (fetched.length === 0) return hardcoded;

  const seen = new Set(hardcoded.map((t) => t.address.toLowerCase()));
  const merged: TokenInfo[] = [...hardcoded];

  for (const t of fetched) {
    const addr = t.address ?? t.contractAddress;
    if (!addr) continue;
    const lower = addr.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    merged.push({
      address: addr,
      name: t.name ?? `${addr.slice(0, 8)}…`,
      symbol: t.symbol ?? '???',
      decimals: t.decimals ?? 8,
    });
  }

  return merged;
}
