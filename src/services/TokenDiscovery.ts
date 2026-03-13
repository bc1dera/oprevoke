import type { AbstractRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { getKnownTokens } from '../config/contracts.js';
import { isMainnet, isTestnet } from '../config/networks.js';
import type { TokenInfo } from '../types/index.js';

// ─── Explorer REST fallback ───────────────────────────────────────────────────

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
    explorerUrl = 'https://testnet.opnet.org';
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

// ─── Block-scan contract discovery ───────────────────────────────────────────
//
// OPNet exposes no "get OP-20 tokens for address" RPC, so we scan blocks for
// deployment addresses and let the caller filter with balanceOf().  Results
// are cached per network in localStorage so subsequent scans are incremental.

const LS_CONTRACT_CACHE_KEY = 'oprevoke:contractCache';

// How many blocks to scan on the very first run (before any cache exists).
// Enough to cover the whole OPNet testnet/mainnet history in most cases.
const INITIAL_SCAN_DEPTH = 10_000;

// Blocks to request per JSON-RPC batch call.
const BATCH_SIZE = 50;

interface ContractCache {
  lastBlock: number;
  addresses: string[]; // hex addresses (e.g. 0xabc…)
}

function networkCacheKey(networkId: string): string {
  return `${LS_CONTRACT_CACHE_KEY}:${networkId}`;
}

function loadContractCache(networkId: string): ContractCache {
  try {
    const raw = localStorage.getItem(networkCacheKey(networkId));
    if (raw) return JSON.parse(raw) as ContractCache;
  } catch {
    // ignore parse errors
  }
  return { lastBlock: 0, addresses: [] };
}

function saveContractCache(networkId: string, cache: ContractCache): void {
  try {
    localStorage.setItem(networkCacheKey(networkId), JSON.stringify(cache));
  } catch {
    // storage full — skip, cache will rebuild next time
  }
}

function getNetworkId(network: Network): string {
  if (isMainnet(network)) return 'mainnet';
  if (isTestnet(network)) return 'testnet';
  return 'regtest';
}

/**
 * Scan OPNet blocks for deployed contract addresses (cached, incremental).
 *
 * Each block's `deployments` array contains all contracts deployed in that
 * block.  We accumulate these across all blocks and cache them so that only
 * new blocks need to be fetched on the next call.
 *
 * The caller should further filter by `balanceOf(userAddress) > 0` to find
 * which of these contracts the user actually holds — failed calls simply mean
 * the contract is not OP-20 or the user holds nothing.
 */
export async function discoverDeployedContracts(
  provider: AbstractRpcProvider,
  network: Network,
  onProgress?: (message: string) => void,
): Promise<string[]> {
  const networkId = getNetworkId(network);
  const cache = loadContractCache(networkId);

  let currentBlock: number;
  try {
    currentBlock = Number(await provider.getBlockNumber());
  } catch {
    // RPC failure — return whatever we have cached
    return cache.addresses;
  }

  if (currentBlock <= cache.lastBlock) {
    // No new blocks since last scan
    return cache.addresses;
  }

  const fromBlock =
    cache.lastBlock === 0
      ? Math.max(1, currentBlock - INITIAL_SCAN_DEPTH)
      : cache.lastBlock + 1;

  const totalBlocks = currentBlock - fromBlock + 1;
  if (totalBlocks > 0) {
    onProgress?.(`Scanning ${totalBlocks.toLocaleString()} blocks for deployed tokens…`);
  }

  const newAddresses: string[] = [];

  for (let start = fromBlock; start <= currentBlock; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, currentBlock);
    const blockNums = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    try {
      const blocks = await provider.getBlocks(blockNums, false);
      for (const block of blocks) {
        for (const addr of block.deployments) {
          newAddresses.push(addr.toHex());
        }
      }
    } catch {
      // ignore failed batches — partial results are fine
    }
  }

  // Merge with cache, dedup
  const allAddresses = [...new Set([...cache.addresses, ...newAddresses])];
  saveContractCache(networkId, { lastBlock: currentBlock, addresses: allAddresses });

  return allAddresses;
}
