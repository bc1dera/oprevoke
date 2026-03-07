import { useCallback, useState } from 'react';
import { Address } from '@btc-vision/transaction';
import { fromBech32 } from '@btc-vision/bitcoin';
import type { AbstractRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { getKnownSpenders, getKnownTokens } from '../config/contracts.js';
import { discoverTokens } from '../services/TokenDiscovery.js';
import { contractService } from '../services/ContractService.js';
import type { AllowanceEntry, SpenderInfo, TokenInfo } from '../types/index.js';

const LS_TOKENS_KEY = 'oprevoke:customTokens';
const LS_SPENDERS_KEY = 'oprevoke:customSpenders';

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
  const [customTokens, setCustomTokens] = useState<TokenInfo[]>(() => loadFromStorage<TokenInfo>(LS_TOKENS_KEY));
  const [customSpenders, setCustomSpenders] = useState<SpenderInfo[]>(() => loadFromStorage<SpenderInfo>(LS_SPENDERS_KEY));

  const addCustomToken = useCallback(
    (address: string, provider: AbstractRpcProvider, network: Network) => {
      const already = customTokens.some(
        (t) => t.address.toLowerCase() === address.toLowerCase(),
      );
      if (already) return;

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
    ) => {
      setScanning(true);
      setScanError(null);
      setEntries([]);
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

      const knownSpenders = getKnownSpenders(network);
      const customSpenderAddrs = new Set(knownSpenders.map((s) => s.address.toLowerCase()));
      const extraCustomSpenders = customSpenders.filter(
        (cs) => !customSpenderAddrs.has(cs.address.toLowerCase()),
      );
      const spenders = [...knownSpenders, ...extraCustomSpenders];

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
          'No spender contracts are configured for this network. Contact support or check back when mainnet spenders are available.',
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

          try {
            const meta = await contract.metadata();
            tokenInfo = {
              ...token,
              name: meta.properties.name,
              symbol: meta.properties.symbol,
              decimals: meta.properties.decimals,
            };
          } catch {
            // keep pre-configured info
          }

          for (const spender of spenders) {
            try {
              const spenderAddr = spender.address.startsWith('0x')
                ? Address.fromString(spender.address)
                : Address.wrap(fromBech32(spender.address).data);
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
            } catch {
              // no allowance for this (token, spender) pair — skip silently
            }
          }
        } catch (err) {
          console.warn(`Could not scan token ${token.address}:`, err);
        }
      }

      setEntries(results);
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
