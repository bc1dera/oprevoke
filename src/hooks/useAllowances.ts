import { useCallback, useState } from 'react';
import { Address } from '@btc-vision/transaction';
import type { AbstractRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { getKnownSpenders, getKnownTokens } from '../config/contracts.js';
import { isMainnet, isTestnet } from '../config/networks.js';
import { discoverDeployedContracts, discoverTokens } from '../services/TokenDiscovery.js';
import { scanForApprovals } from '../services/ApprovalScanner.js';
import { contractService } from '../services/ContractService.js';
import type { AllowanceEntry, SpenderInfo, TokenInfo } from '../types/index.js';

const LS_TOKENS_KEY = 'oprevoke:customTokens';
const LS_SPENDERS_KEY = 'oprevoke:customSpenders';
const LS_RESULTS_KEY = 'oprevoke:scanResults';

export interface ScanSummary {
  tokenCount: number;
  spenders: SpenderInfo[];
  mode: 'known' | 'custom';
}

// ─── Local-storage helpers ────────────────────────────────────────────────────

function loadFromStorage<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

function saveToStorage<T>(key: string, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

// ─── Scan-result persistence ──────────────────────────────────────────────────

/** Bigint-safe serialised form of AllowanceEntry */
type SerializedEntry = Omit<AllowanceEntry, 'allowance'> & { allowance: string };

interface PersistedScan {
  networkId: string;
  addressHex: string;
  timestamp: number;
  entries: SerializedEntry[];
  summary: ScanSummary;
}

function getNetworkId(network: Network): string {
  if (isMainnet(network)) return 'mainnet';
  if (isTestnet(network)) return 'testnet';
  return 'regtest';
}

function persistScanResults(
  entries: AllowanceEntry[],
  summary: ScanSummary,
  network: Network,
  addressHex: string,
): void {
  try {
    const data: PersistedScan = {
      networkId: getNetworkId(network),
      addressHex,
      timestamp: Date.now(),
      entries: entries.map((e) => ({ ...e, allowance: e.allowance.toString() })),
      summary,
    };
    localStorage.setItem(LS_RESULTS_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function loadPersistedResults(
  network: Network,
  addressHex: string,
): { entries: AllowanceEntry[]; summary: ScanSummary } | null {
  try {
    const raw = localStorage.getItem(LS_RESULTS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedScan;
    // Must match network, address, and be less than 1 hour old
    if (data.networkId !== getNetworkId(network)) return null;
    if (data.addressHex !== addressHex) return null;
    if (Date.now() - data.timestamp > 60 * 60 * 1000) return null;
    return {
      entries: data.entries.map((e) => ({ ...e, allowance: BigInt(e.allowance) })),
      summary: data.summary,
    };
  } catch {
    return null;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAllowances() {
  const [entries, setEntries] = useState<AllowanceEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ScanSummary | null>(null);
  const [scanErrors, setScanErrors] = useState<Array<{ address: string; name: string; error: string }>>([]);
  const [customTokens, setCustomTokens] = useState<TokenInfo[]>(() => loadFromStorage<TokenInfo>(LS_TOKENS_KEY));
  const [customSpenders, setCustomSpenders] = useState<SpenderInfo[]>(() => loadFromStorage<SpenderInfo>(LS_SPENDERS_KEY));

  // ── Custom token management ──────────────────────────────────────────────

  const addCustomToken = useCallback(
    (address: string, provider: AbstractRpcProvider, network: Network): 'added' | 'already_custom' | 'already_hardcoded' => {
      const lc = address.toLowerCase();
      const alreadyCustom = customTokens.some((t) => t.address.toLowerCase() === lc);
      if (alreadyCustom) return 'already_custom';
      const alreadyHardcoded = getKnownTokens(network).some((t) => t.address.toLowerCase() === lc);
      if (alreadyHardcoded) return 'already_hardcoded';

      const placeholder: TokenInfo = {
        address,
        name: address.slice(0, 10) + '…',
        symbol: '???',
        decimals: 8,
        isCustom: true,
      };
      setCustomTokens((prev) => {
        const next = [...prev, placeholder];
        saveToStorage(LS_TOKENS_KEY, next);
        return next;
      });

      void (async () => {
        try {
          const contract = contractService.getTokenContract(address, provider, network);
          const meta = await contract.metadata();
          setCustomTokens((prev) => {
            const next = prev.map((t) =>
              t.address.toLowerCase() === address.toLowerCase()
                ? { ...t, name: meta.properties.name, symbol: meta.properties.symbol, decimals: meta.properties.decimals }
                : t,
            );
            saveToStorage(LS_TOKENS_KEY, next);
            return next;
          });
        } catch {
          // keep placeholder
        }
      })();
      return 'added';
    },
    [customTokens],
  );

  const removeCustomToken = useCallback((address: string) => {
    setCustomTokens((prev) => {
      const next = prev.filter((t) => t.address.toLowerCase() !== address.toLowerCase());
      saveToStorage(LS_TOKENS_KEY, next);
      return next;
    });
  }, []);

  const addCustomSpender = useCallback(
    (address: string, name: string) => {
      const already = customSpenders.some(
        (s) => s.address.toLowerCase() === address.toLowerCase(),
      );
      if (already) return;
      setCustomSpenders((prev) => {
        const next = [...prev, { address, name, description: 'Custom spender' }];
        saveToStorage(LS_SPENDERS_KEY, next);
        return next;
      });
    },
    [customSpenders],
  );

  const removeCustomSpender = useCallback((address: string) => {
    setCustomSpenders((prev) => {
      const next = prev.filter((s) => s.address.toLowerCase() !== address.toLowerCase());
      saveToStorage(LS_SPENDERS_KEY, next);
      return next;
    });
  }, []);

  // ── Cache restore (call on wallet connect) ───────────────────────────────

  const restoreFromCache = useCallback((addressHex: string, network: Network) => {
    const cached = loadPersistedResults(network, addressHex);
    if (cached) {
      setEntries(cached.entries);
      setLastScan(cached.summary);
    }
  }, []);

  // ── Scan ─────────────────────────────────────────────────────────────────

  const scan = useCallback(
    async (
      userAddress: Address,
      walletAddress: string,
      provider: AbstractRpcProvider,
      network: Network,
      scanMode: 'known' | 'custom' = 'known',
    ) => {
      setScanning(true);
      setScanError(null);
      setEntries([]);
      setLastScan(null);
      setScanErrors([]);

      // ── 'known' tab: auto-discover via Approved event scanning ──────────
      if (scanMode === 'known') {
        setScanStatus('Scanning blocks for approvals…');

        let discoveredMap: Map<string, import('../services/ApprovalScanner.js').DiscoveredApproval>;
        try {
          discoveredMap = await scanForApprovals(provider, network, userAddress, setScanStatus);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          setScanError(`Block scan failed: ${msg}`);
          setScanStatus(null);
          setScanning(false);
          return;
        }

        const discovered = [...discoveredMap.values()];

        if (discovered.length === 0) {
          setScanError(
            'No token approvals found in your transaction history. ' +
            'If you have approvals on an older part of the chain, try switching to the Custom Spenders tab.',
          );
          setScanStatus(null);
          setScanning(false);
          return;
        }

        setScanStatus(`Verifying ${discovered.length} discovered approval${discovered.length !== 1 ? 's' : ''}…`);

        // Verify each discovered approval is still active on-chain
        const verifyResults = await Promise.allSettled(
          discovered.map(async (d) => {
            const contract = contractService.getTokenContract(d.tokenAddress, provider, network);
            contract.setSender(userAddress);
            const spenderAddr = Address.fromString(d.spenderAddress);
            const result = await contract.allowance(userAddress, spenderAddr);
            return { d, remaining: result.properties.remaining, spenderAddr };
          }),
        );

        // Collect active (remaining > 0) allowances
        const active = verifyResults.filter(
          (r): r is PromiseFulfilledResult<{
            d: (typeof discovered)[number];
            remaining: bigint;
            spenderAddr: Address;
          }> => r.status === 'fulfilled' && r.value.remaining > 0n,
        );

        // Fetch metadata for unique token addresses
        const uniqueTokenAddrs = [...new Set(active.map((r) => r.value.d.tokenAddress))];
        const tokenMetaMap = new Map<string, TokenInfo>();

        await Promise.allSettled(
          uniqueTokenAddrs.map(async (addr) => {
            const contract = contractService.getTokenContract(addr, provider, network);
            contract.setSender(userAddress);
            try {
              const meta = await contract.metadata();
              tokenMetaMap.set(addr.toLowerCase(), {
                address: addr,
                name: meta.properties.name,
                symbol: meta.properties.symbol,
                decimals: meta.properties.decimals,
              });
            } catch {
              tokenMetaMap.set(addr.toLowerCase(), {
                address: addr,
                name: addr.slice(0, 10) + '…',
                symbol: '???',
                decimals: 8,
              });
            }
          }),
        );

        // Build spender name lookup from known spenders config
        const knownSpenders = getKnownSpenders(network);
        const spenderNameMap = new Map(
          knownSpenders.map((s) => [s.address.toLowerCase(), s]),
        );

        // Build final entries
        const results: AllowanceEntry[] = [];
        const errors: Array<{ address: string; name: string; error: string }> = [];

        for (const result of verifyResults) {
          if (result.status === 'rejected') {
            errors.push({
              address: 'unknown',
              name: 'Unknown token',
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
            continue;
          }
          const { d, remaining } = result.value;
          if (remaining <= 0n) continue;

          const tokenInfo = tokenMetaMap.get(d.tokenAddress.toLowerCase()) ?? {
            address: d.tokenAddress,
            name: d.tokenAddress.slice(0, 10) + '…',
            symbol: '???',
            decimals: 8,
          };

          const spenderLower = d.spenderAddress.toLowerCase();
          const spenderInfo: SpenderInfo = spenderNameMap.get(spenderLower) ?? {
            address: d.spenderAddress,
            name: d.spenderAddress.slice(0, 10) + '…',
            description: 'Discovered from approval history',
          };

          results.push({
            id: `${d.tokenAddress.toLowerCase()}:${spenderLower}`,
            token: tokenInfo,
            spender: spenderInfo,
            allowance: remaining,
            status: 'idle',
          });
        }

        const uniqueSpenders = [...new Map(results.map((r) => [r.spender.address.toLowerCase(), r.spender])).values()];
        const summary: ScanSummary = {
          tokenCount: uniqueTokenAddrs.length,
          spenders: uniqueSpenders,
          mode: 'known',
        };

        setEntries(results);
        setScanErrors(errors);
        setLastScan(summary);
        setScanStatus(null);
        setScanning(false);
        persistScanResults(results, summary, network, walletAddress);
        return;
      }

      // ── 'custom' tab: check known+custom tokens against custom spenders ──
      setScanStatus('Fetching token list…');

      let knownTokens: TokenInfo[] = [];
      try {
        knownTokens = await discoverTokens(network);
      } catch {
        knownTokens = getKnownTokens(network);
      }

      let deployedAddresses: string[] = [];
      try {
        deployedAddresses = await discoverDeployedContracts(provider, network, setScanStatus);
      } catch {
        // ignore — fall back to known list only
      }

      const knownAddrs = new Set(knownTokens.map((t) => t.address.toLowerCase()));
      const extraCustom = customTokens.filter((ct) => !knownAddrs.has(ct.address.toLowerCase()));

      const unknownDeployedTokens: TokenInfo[] = deployedAddresses
        .filter((addr) => !knownAddrs.has(addr.toLowerCase()))
        .map((addr) => ({
          address: addr,
          name: addr.slice(0, 10) + '…',
          symbol: '???',
          decimals: 8,
        }));

      const allCandidates: TokenInfo[] = [...knownTokens, ...unknownDeployedTokens, ...extraCustom];

      setScanStatus(`Checking wallet balances for ${allCandidates.length} token candidates…`);
      const balanceResults = await Promise.allSettled(
        allCandidates.map(async (token) => {
          const contract = contractService.getTokenContract(token.address, provider, network);
          contract.setSender(userAddress);
          const res = await contract.balanceOf(userAddress);
          return { token, held: res.properties.balance > 0n };
        }),
      );

      const heldCandidates = balanceResults
        .filter(
          (r): r is PromiseFulfilledResult<{ token: TokenInfo; held: boolean }> =>
            r.status === 'fulfilled' && r.value.held,
        )
        .map((r) => r.value.token);

      const heldKnownOrDiscovered = heldCandidates.filter(
        (t) => !extraCustom.some((c) => c.address.toLowerCase() === t.address.toLowerCase()),
      );
      const tokens: TokenInfo[] = [...heldKnownOrDiscovered, ...extraCustom];

      const spenders: SpenderInfo[] = customSpenders;

      if (tokens.length === 0 && spenders.length === 0) {
        setScanStatus(null);
        setScanning(false);
        setScanError(
          'No tokens or spenders found. Add a custom spender address below and try again.',
        );
        return;
      }

      if (tokens.length === 0) {
        setScanStatus(null);
        setScanning(false);
        setScanError(
          'No tokens found in your wallet. Use the token input below to add a contract address.',
        );
        return;
      }

      if (spenders.length === 0) {
        setScanStatus(null);
        setScanning(false);
        setScanError('No custom spenders added. Use the input below to add a spender address.');
        return;
      }

      setScanStatus(
        `Scanning ${tokens.length} token${tokens.length !== 1 ? 's' : ''} against ${spenders.length} spender${spenders.length !== 1 ? 's' : ''}…`,
      );

      const perTokenResults = await Promise.allSettled(
        tokens.map(async (token) => {
          const contract = contractService.getTokenContract(token.address, provider, network);
          contract.setSender(userAddress);

          let tokenInfo: TokenInfo = token;
          try {
            const meta = await contract.metadata();
            tokenInfo = {
              ...token,
              name: meta.properties.name,
              symbol: meta.properties.symbol,
              decimals: meta.properties.decimals,
            };
          } catch {
            // keep existing info
          }

          const spenderResults = await Promise.allSettled(
            spenders.map(async (spender) => {
              const spenderAddr = Address.fromString(spender.address);
              const result = await contract.allowance(userAddress, spenderAddr);
              return { spender, remaining: result.properties.remaining };
            }),
          );

          return { token, tokenInfo, spenderResults };
        }),
      );

      const results: AllowanceEntry[] = [];
      const errors: Array<{ address: string; name: string; error: string }> = [];

      for (const tokenResult of perTokenResults) {
        if (tokenResult.status === 'rejected') {
          errors.push({
            address: 'unknown',
            name: 'Unknown token',
            error: tokenResult.reason instanceof Error ? tokenResult.reason.message : String(tokenResult.reason),
          });
          continue;
        }

        const { token, tokenInfo, spenderResults } = tokenResult.value;

        for (const spenderResult of spenderResults) {
          if (spenderResult.status === 'rejected') {
            errors.push({
              address: token.address,
              name: tokenInfo.symbol || tokenInfo.name,
              error: spenderResult.reason instanceof Error ? spenderResult.reason.message : String(spenderResult.reason),
            });
            continue;
          }

          const { spender, remaining } = spenderResult.value;
          if (remaining > 0n) {
            results.push({
              id: `${token.address.toLowerCase()}:${spender.address.toLowerCase()}`,
              token: tokenInfo,
              spender,
              allowance: remaining,
              status: 'idle',
            });
          }
        }
      }

      const summary: ScanSummary = { tokenCount: tokens.length, spenders, mode: 'custom' };

      setEntries(results);
      setScanErrors(errors);
      setLastScan(summary);
      setScanStatus(null);
      setScanning(false);
      persistScanResults(results, summary, network, walletAddress);
    },
    [customTokens, customSpenders],
  );

  // ── Entry status update ───────────────────────────────────────────────────

  const updateEntryStatus = useCallback(
    (
      id: string,
      status: AllowanceEntry['status'],
      errorMessage?: string,
      txId?: string,
    ) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, status, errorMessage, txId } : e)),
      );
    },
    [],
  );

  return {
    entries,
    scanning,
    scanError,
    scanStatus,
    lastScan,
    scanErrors,
    customTokens,
    addCustomToken,
    removeCustomToken,
    customSpenders,
    addCustomSpender,
    removeCustomSpender,
    scan,
    updateEntryStatus,
    restoreFromCache,
  };
}
