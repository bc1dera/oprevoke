import { useCallback, useState } from 'react';
import { Address } from '@btc-vision/transaction';
import type { AbstractRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { getKnownSpenders, getKnownTokens } from '../config/contracts.js';
import { discoverTokens } from '../services/TokenDiscovery.js';
import { contractService } from '../services/ContractService.js';
import type { AllowanceEntry, SpenderInfo, TokenInfo } from '../types/index.js';

const LS_TOKENS_KEY = 'oprevoke:customTokens';
const LS_SPENDERS_KEY = 'oprevoke:customSpenders';

export interface ScanSummary {
  tokenCount: number;
  spenders: SpenderInfo[];
  mode: 'known' | 'custom';
}

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

export function useAllowances() {
  const [entries, setEntries] = useState<AllowanceEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ScanSummary | null>(null);
  const [scanErrors, setScanErrors] = useState<Array<{ address: string; name: string; error: string }>>([]);
  const [customTokens, setCustomTokens] = useState<TokenInfo[]>(() => loadFromStorage<TokenInfo>(LS_TOKENS_KEY));
  const [customSpenders, setCustomSpenders] = useState<SpenderInfo[]>(() => loadFromStorage<SpenderInfo>(LS_SPENDERS_KEY));

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
                ? {
                    ...t,
                    name: meta.properties.name,
                    symbol: meta.properties.symbol,
                    decimals: meta.properties.decimals,
                  }
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

  const scan = useCallback(
    async (
      userAddress: Address,
      provider: AbstractRpcProvider,
      network: Network,
      scanMode: 'known' | 'custom' = 'known',
    ) => {
      setScanning(true);
      setScanError(null);
      setEntries([]);
      setLastScan(null);
      setScanErrors([]);
      setScanStatus('Fetching token list…');

      let knownTokens: TokenInfo[] = [];
      try {
        knownTokens = await discoverTokens(network);
      } catch {
        knownTokens = getKnownTokens(network);
      }

      // Merge discovered tokens with any user-added custom tokens
      const customAddrs = new Set(knownTokens.map((t) => t.address.toLowerCase()));
      const extraCustom = customTokens.filter((ct) => !customAddrs.has(ct.address.toLowerCase()));
      const tokens = [...knownTokens, ...extraCustom];

      let spenders: SpenderInfo[];
      if (scanMode === 'custom') {
        spenders = customSpenders;
      } else {
        spenders = getKnownSpenders(network);
      }

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
          'No tokens found for this network. Use the token input below to add a contract address and try again.',
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

      const results: AllowanceEntry[] = [];

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        setScanStatus(`Scanning token ${i + 1} of ${tokens.length}…`);

        let tokenInfo = token;

        try {
          const contract = contractService.getTokenContract(
            token.address,
            provider,
            network,
          );
          contract.setSender(userAddress);

          try {
            const meta = await contract.metadata();
            tokenInfo = {
              ...token,
              name: meta.properties.name,
              symbol: meta.properties.symbol,
              decimals: meta.properties.decimals,
            };
          } catch (err) {
            console.warn(`metadata(${token.address}):`, err);
          }

          for (const spender of spenders) {
            try {
              const spenderAddr = Address.fromString(spender.address);
              const result = await contract.allowance(userAddress, spenderAddr);
              const remaining = result.properties.remaining;

              if (remaining > 0n) {
                results.push({
                  id: `${token.address.toLowerCase()}:${spender.address.toLowerCase()}`,
                  token: tokenInfo,
                  spender,
                  allowance: remaining,
                  status: 'idle',
                });
              }
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              console.error(`allowance(${token.address}, ${spender.address}):`, err);
              setScanErrors((prev) => [
                ...prev,
                {
                  address: token.address,
                  name: `${tokenInfo.symbol || tokenInfo.name} vs ${spender.name}`,
                  error: errMsg,
                },
              ]);
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`Could not scan token ${token.address}:`, err);
          setScanErrors((prev) => [
            ...prev,
            { address: token.address, name: tokenInfo.symbol || tokenInfo.name, error: errMsg },
          ]);
        }
      }

      setEntries(results);
      setLastScan({ tokenCount: tokens.length, spenders, mode: scanMode });
      setScanStatus(null);
      setScanning(false);
    },
    [customTokens, customSpenders],
  );

  const updateEntryStatus = useCallback(
    (
      id: string,
      status: AllowanceEntry['status'],
      errorMessage?: string,
    ) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, status, errorMessage } : e)),
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
  };
}
