import { useCallback, useState } from 'react';
import { Address } from '@btc-vision/transaction';
import type { AbstractRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { getKnownSpenders, getKnownTokens } from '../config/contracts.js';
import { isMainnet, isTestnet } from '../config/networks.js';

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
      setScanStatus('Loading token list…');

      // 1. Tokens: hardcoded config + user-added custom tokens
      const knownTokens = getKnownTokens(network);
      const knownAddrs = new Set(knownTokens.map((t) => t.address.toLowerCase()));
      const extraCustom = customTokens.filter((ct) => !knownAddrs.has(ct.address.toLowerCase()));
      const tokens: TokenInfo[] = [...knownTokens, ...extraCustom];

      // 2. Determine spenders
      const spenders: SpenderInfo[] =
        scanMode === 'custom' ? customSpenders : getKnownSpenders(network);

      if (tokens.length === 0 && spenders.length === 0) {
        setScanStatus(null);
        setScanning(false);
        setScanError(
          'No tokens or spenders found for this network. Use the token input below to add a contract address and try again.',
        );
        return;
      }

      if (tokens.length === 0) {
        setScanStatus(null);
        setScanning(false);
        setScanError(
          'No tokens found in your wallet for this network. If you hold tokens not listed here, use the token input below to add them manually.',
        );
        return;
      }

      if (spenders.length === 0) {
        setScanStatus(null);
        setScanning(false);
        setScanError(
          scanMode === 'custom'
            ? 'No custom spenders added. Use the input below to add a spender address.'
            : 'No spender contracts are configured for this network. Contact support or check back when mainnet spenders are available.',
        );
        return;
      }

      // 3. Parallel scan: fetch metadata + check all spender allowances per token
      setScanStatus(
        `Scanning ${tokens.length} token${tokens.length !== 1 ? 's' : ''} against ${spenders.length} spender${spenders.length !== 1 ? 's' : ''}…`,
      );

      const perTokenResults = await Promise.allSettled(
        tokens.map(async (token) => {
          const contract = contractService.getTokenContract(token.address, provider, network);
          contract.setSender(userAddress);

          // Refresh metadata in case custom token placeholder still has '???'
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

          // Check all spenders for this token in parallel
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

      // 5. Collect entries + errors
      const results: AllowanceEntry[] = [];
      const errors: Array<{ address: string; name: string; error: string }> = [];

      for (const tokenResult of perTokenResults) {
        if (tokenResult.status === 'rejected') {
          const errMsg =
            tokenResult.reason instanceof Error
              ? tokenResult.reason.message
              : String(tokenResult.reason);
          errors.push({ address: 'unknown', name: 'Unknown token', error: errMsg });
          continue;
        }

        const { token, tokenInfo, spenderResults } = tokenResult.value;

        for (const spenderResult of spenderResults) {
          if (spenderResult.status === 'rejected') {
            const errMsg =
              spenderResult.reason instanceof Error
                ? spenderResult.reason.message
                : String(spenderResult.reason);
            errors.push({
              address: token.address,
              name: tokenInfo.symbol || tokenInfo.name,
              error: errMsg,
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

      const summary: ScanSummary = { tokenCount: tokens.length, spenders, mode: scanMode };

      setEntries(results);
      setScanErrors(errors);
      setLastScan(summary);
      setScanStatus(null);
      setScanning(false);

      // Persist for instant restore on next session
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
