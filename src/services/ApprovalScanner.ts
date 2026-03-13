/**
 * ApprovalScanner — discovers OP-20 token approvals by scanning raw block events.
 *
 * Instead of enumerating a known token list and probing balances, we scan every
 * block's transactions for `Approved` events emitted by any OP-20 contract.
 * The contract address is the key in `tx.events`, so we automatically discover
 * any token that has ever emitted an Approved event for this user — no prior
 * knowledge of token addresses required.
 *
 * Results are cached per (network, userAddress) in localStorage so subsequent
 * scans only fetch blocks since the last run.
 */

import { BinaryReader, Address } from '@btc-vision/transaction';
import type { AbstractRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { isMainnet, isTestnet } from '../config/networks.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscoveredApproval {
  /** Address of the OP-20 token contract (hex, e.g. 0xabc…) */
  tokenAddress: string;
  /** Address of the approved spender (hex) */
  spenderAddress: string;
  /** Allowance amount at the time of the last observed Approved event.
   *  May be stale — callers must verify via contract.allowance(). */
  amount: bigint;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

const LS_SCAN_KEY = 'oprevoke:approvalScan';

interface PersistedCache {
  lastBlock: number;
  // [key, { tokenAddress, spenderAddress, amount (as string) }][]
  entries: Array<[string, { tokenAddress: string; spenderAddress: string; amount: string }]>;
}

function cacheKey(networkId: string, userHex: string): string {
  return `${LS_SCAN_KEY}:${networkId}:${userHex}`;
}

function loadCache(
  networkId: string,
  userHex: string,
): { lastBlock: number; approvals: Map<string, DiscoveredApproval> } {
  try {
    const raw = localStorage.getItem(cacheKey(networkId, userHex));
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedCache;
      return {
        lastBlock: parsed.lastBlock,
        approvals: new Map(
          parsed.entries.map(([k, v]) => [k, { ...v, amount: BigInt(v.amount) }]),
        ),
      };
    }
  } catch {
    // corrupt cache — start fresh
  }
  return { lastBlock: 0, approvals: new Map() };
}

function saveCache(
  networkId: string,
  userHex: string,
  lastBlock: number,
  approvals: Map<string, DiscoveredApproval>,
): void {
  try {
    const data: PersistedCache = {
      lastBlock,
      entries: [...approvals.entries()].map(([k, v]) => [
        k,
        { tokenAddress: v.tokenAddress, spenderAddress: v.spenderAddress, amount: v.amount.toString() },
      ]),
    };
    localStorage.setItem(cacheKey(networkId, userHex), JSON.stringify(data));
  } catch {
    // storage full — skip; cache will be rebuilt next time
  }
}

function getNetworkId(network: Network): string {
  if (isMainnet(network)) return 'mainnet';
  if (isTestnet(network)) return 'testnet';
  return 'regtest';
}

// ─── Event decoding ───────────────────────────────────────────────────────────

const APPROVED_EVENT = 'Approved';

/**
 * Decode the binary payload of an OP-20 `Approved` event.
 * Layout: owner (32 bytes) | spender (32 bytes) | amount (32 bytes u256)
 */
function decodeApprovedEvent(
  data: Uint8Array,
): { owner: Address; spender: Address; amount: bigint } | null {
  try {
    const reader = new BinaryReader(data);
    const owner = reader.readAddress();
    const spender = reader.readAddress();
    const amount = reader.readU256();
    return { owner, spender, amount };
  } catch {
    return null;
  }
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

const BATCH_SIZE = 50;        // blocks per getBlocks() call
const CONCURRENT_BATCHES = 3; // concurrent getBlocks() calls in-flight
const INITIAL_SCAN_DEPTH = 10_000; // blocks to scan on first run

/**
 * Scan OPNet blocks for OP-20 `Approved` events owned by `userAddress`.
 *
 * Returns a Map keyed by `"tokenAddress:spenderAddress"` with the most
 * recently observed allowance amount.  Results are cached and subsequent
 * calls only fetch new blocks since the last scan.
 *
 * `onNewApprovals` is called (and awaited) after each concurrent window
 * completes, receiving only the approvals that are brand-new in that window.
 * This lets callers verify and display results progressively rather than
 * waiting for the entire scan to finish.
 *
 * The caller should verify each entry with `contract.allowance()` before
 * displaying, since the on-chain value may differ from the event amount.
 */
export async function scanForApprovals(
  provider: AbstractRpcProvider,
  network: Network,
  userAddress: Address,
  onProgress?: (message: string) => void,
  onNewApprovals?: (approvals: DiscoveredApproval[]) => Promise<void>,
): Promise<Map<string, DiscoveredApproval>> {
  const networkId = getNetworkId(network);
  const userHex = userAddress.toHex().toLowerCase();
  const { lastBlock, approvals } = loadCache(networkId, userHex);

  let currentBlock: number;
  try {
    currentBlock = Number(await provider.getBlockNumber());
  } catch {
    return approvals; // RPC failure — return cached data
  }

  if (currentBlock <= lastBlock) {
    return approvals; // nothing new to scan
  }

  const fromBlock = lastBlock === 0
    ? Math.max(1, currentBlock - INITIAL_SCAN_DEPTH)
    : lastBlock + 1;

  const totalBlocks = currentBlock - fromBlock + 1;
  onProgress?.(`Scanning ${totalBlocks.toLocaleString()} blocks for approvals…`);

  // Build list of block-number batches
  const batches: number[][] = [];
  for (let start = fromBlock; start <= currentBlock; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, currentBlock);
    batches.push(Array.from({ length: end - start + 1 }, (_, i) => start + i));
  }

  // Fetch batches with limited concurrency; notify caller of new discoveries
  // after each concurrent window so they can verify + display progressively.
  for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
    const window = batches.slice(i, i + CONCURRENT_BATCHES);

    // Snapshot keys before this window to detect new entries
    const keysBefore = new Set(approvals.keys());

    const results = await Promise.allSettled(
      window.map((blockNums) => provider.getBlocks(blockNums, true /* prefetchTxs */)),
    );

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;

      for (const block of result.value) {
        for (const tx of block.transactions) {
          // Every TransactionBase inherits events from TransactionReceipt.
          // events is { [contractAddress: string]: NetEvent[] }
          const events = (tx as unknown as { events: Record<string, Array<{ type: string; data: Uint8Array }>> }).events;
          if (!events) continue;

          for (const [contractAddress, netEvents] of Object.entries(events)) {
            for (const event of netEvents) {
              if (event.type !== APPROVED_EVENT) continue;

              const decoded = decodeApprovedEvent(event.data);
              if (!decoded) continue;

              // Only keep approvals where this user is the owner
              if (decoded.owner.toHex().toLowerCase() !== userHex) continue;

              const key = `${contractAddress.toLowerCase()}:${decoded.spender.toHex().toLowerCase()}`;
              approvals.set(key, {
                tokenAddress: contractAddress,
                spenderAddress: decoded.spender.toHex(),
                amount: decoded.amount,
              });
            }
          }
        }
      }
    }

    // Notify caller of brand-new discoveries from this window
    if (onNewApprovals) {
      const newApprovals = [...approvals.entries()]
        .filter(([k]) => !keysBefore.has(k))
        .map(([, v]) => v);
      if (newApprovals.length > 0) {
        await onNewApprovals(newApprovals);
      }
    }
  }

  saveCache(networkId, userHex, currentBlock, approvals);
  return approvals;
}
