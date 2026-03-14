import { useCallback, useEffect, useRef, useState, useMemo, useId } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { WalletNetworks } from '@btc-vision/transaction';
import type { Network } from '@btc-vision/bitcoin';
import { contractService } from './services/ContractService.js';
import { getNetworkConfig, isMainnet } from './config/networks.js';
import { useAllowances } from './hooks/useAllowances.js';
import { useRevoke } from './hooks/useRevoke.js';
import { useTheme } from './hooks/useTheme.js';
import { ConnectButton } from './components/wallet/ConnectButton.js';
import { TokenInput } from './components/revoke/TokenInput.js';
import { SpenderInput } from './components/revoke/SpenderInput.js';
import { AllowanceTable } from './components/revoke/AllowanceTable.js';
import { Button } from './components/common/Button.js';

export default function App() {
  const { address, walletAddress, walletInstance, provider, network } = useWalletConnect();
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const networkMenuRef = useRef<HTMLDivElement>(null);
  const networkMenuId = useId();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (networkMenuRef.current && !networkMenuRef.current.contains(e.target as Node)) {
        setNetworkMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSwitchNetwork = useCallback(async (target: WalletNetworks) => {
    if (!walletInstance || !network || switchingNetwork) return;
    setNetworkMenuOpen(false);
    if (
      (target === WalletNetworks.Mainnet && isMainnet(network)) ||
      (target === WalletNetworks.OpnetTestnet && !isMainnet(network))
    ) return; // already on that network
    setSwitchingNetwork(true);
    try {
      await walletInstance.switchNetwork(target);
    } catch {
      // user dismissed or wallet rejected — ignore
    } finally {
      setSwitchingNetwork(false);
    }
  }, [walletInstance, network, switchingNetwork]);
  const isConnectedAndReady = !!walletAddress && !!address && !!provider && !!network;
  const { theme, toggle: toggleTheme } = useTheme();

  const [activePage, setActivePage] = useState<'revoke' | 'shield'>('revoke');
  const [activeTab, setActiveTab] = useState<'known' | 'custom'>('known');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [showSpenderInput, setShowSpenderInput] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRevoking, setBulkRevoking] = useState(false);

  const {
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
  } = useAllowances();

  const { revoke, batchRevoke } = useRevoke();

  // Clear contract cache when network changes to avoid stale providers
  const prevNetworkRef = useRef<Network | null>(null);
  useEffect(() => {
    if (network && prevNetworkRef.current && prevNetworkRef.current !== network) {
      contractService.clearCache();
    }
    prevNetworkRef.current = network;
  }, [network]);

  // Work around a stale-closure bug in @btc-vision/walletconnect: the library
  // registers its chainChanged hook before setSelectedWallet fires, so the
  // captured selectedWallet is null and setNetwork() is never called when the
  // user switches networks.  We attach our own listener directly on the raw
  // walletInstance and reload — the library auto-reconnects on load with the
  // correct network already set.
  useEffect(() => {
    if (!walletInstance) return;
    const wi = walletInstance as unknown as {
      on?: (event: string, fn: () => void) => void;
      removeListener?: (event: string, fn: () => void) => void;
    };
    const handleChainChanged = () => {
      window.location.reload();
    };
    wi.on?.('chainChanged', handleChainChanged);
    return () => {
      wi.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [walletInstance]);

  // Restore cached scan results when wallet connects
  const didRestoreCacheRef = useRef(false);
  useEffect(() => {
    if (isConnectedAndReady && walletAddress && network && !didRestoreCacheRef.current) {
      didRestoreCacheRef.current = true;
      restoreFromCache(walletAddress, network);
    }
    if (!isConnectedAndReady) {
      didRestoreCacheRef.current = false;
    }
  }, [isConnectedAndReady, walletAddress, network, restoreFromCache]);

  const handleScan = useCallback(() => {
    if (!address || !walletAddress || !provider || !network) return;
    setSelectedIds(new Set());
    void scan(address, walletAddress, provider, network, activeTab);
  }, [address, walletAddress, provider, network, scan, activeTab]);

  const handleTabChange = useCallback((tab: 'known' | 'custom') => {
    setActiveTab(tab);
    setSelectedIds(new Set());
    setShowTokenInput(false);
    setShowSpenderInput(false);
  }, []);

  const selectableIds = useMemo(
    () => entries.filter((e) => e.status !== 'revoked').map((e) => e.id),
    [entries],
  );

  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? new Set(selectableIds) : new Set());
    },
    [selectableIds],
  );

  const handleRevokeSelected = useCallback(async () => {
    if (!provider || !network || !walletAddress || !address || bulkRevoking) return;

    const toRevoke = entries.filter(
      (e) => selectedIds.has(e.id) && e.status !== 'revoked' && e.status !== 'revoking',
    );
    if (toRevoke.length === 0) return;

    setBulkRevoking(true);

    // Mark all selected entries as revoking upfront so the user sees immediate feedback
    for (const entry of toRevoke) {
      updateEntryStatus(entry.id, 'revoking');
    }

    await batchRevoke(
      toRevoke.map((e) => ({
        id: e.id,
        tokenAddress: e.token.address,
        spenderAddress: e.spender.address,
        currentAllowance: e.allowance,
      })),
      walletAddress,
      address,
      provider,
      network,
      (id, txId) => {
        updateEntryStatus(id, 'revoked', undefined, txId);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },
      (id, msg) => {
        updateEntryStatus(id, 'error', msg);
      },
    );

    setBulkRevoking(false);
  }, [entries, selectedIds, provider, network, walletAddress, address, bulkRevoking, batchRevoke, updateEntryStatus]);

  const handleRevoke = useCallback(
    async (id: string) => {
      if (!provider || !network || !walletAddress || !address) return;

      const entry = entries.find((e) => e.id === id);
      if (!entry) return;

      updateEntryStatus(id, 'revoking');

      try {
        const txId = await revoke(
          entry.token.address,
          entry.spender.address,
          entry.allowance,
          walletAddress,
          address,
          provider,
          network,
        );

        updateEntryStatus(id, 'revoked', undefined, txId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        updateEntryStatus(id, 'error', msg);
      }
    },
    [entries, provider, network, walletAddress, revoke, updateEntryStatus],
  );

  const networkConfig = network ? getNetworkConfig(network) : null;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-surface-700 bg-surface-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-brand-500 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="currentColor">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l5 2.18V11c0 3.5-2.33 6.79-5 7.93-2.67-1.14-5-4.43-5-7.93V7.18L12 5zm-1 5v6h2v-6h-2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-100 leading-none">OPRevoke</h1>
              <p className="text-xs text-gray-500 leading-none mt-0.5">
                Revoke OP20 token approvals on OPNet
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Network switcher dropdown — only shown when wallet is connected */}
            {isConnectedAndReady && network && (
              <div ref={networkMenuRef} className="relative hidden sm:block">
                <button
                  onClick={() => setNetworkMenuOpen(o => !o)}
                  disabled={switchingNetwork}
                  aria-haspopup="listbox"
                  aria-expanded={networkMenuOpen}
                  aria-controls={networkMenuId}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-surface-600 bg-surface-800 hover:bg-surface-700 hover:border-surface-500 text-xs font-medium text-gray-300 hover:text-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {switchingNetwork ? (
                    <svg className="animate-spin h-2.5 w-2.5 text-gray-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <span className={`h-2 w-2 rounded-full ${isMainnet(network) ? 'bg-orange-400' : 'bg-green-400'}`} />
                  )}
                  {isMainnet(network) ? 'Mainnet' : 'Testnet'}
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 text-gray-500">
                    <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </button>

                {networkMenuOpen && (
                  <ul
                    id={networkMenuId}
                    role="listbox"
                    className="absolute right-0 mt-1.5 w-36 rounded-lg border border-surface-600 bg-surface-800 shadow-lg py-1 z-50"
                  >
                    {([
                      { label: 'Mainnet', value: WalletNetworks.Mainnet, dot: 'bg-orange-400' },
                      { label: 'Testnet', value: WalletNetworks.OpnetTestnet, dot: 'bg-green-400' },
                    ] as const).map(({ label, value, dot }) => {
                      const active =
                        value === WalletNetworks.Mainnet ? isMainnet(network) : !isMainnet(network);
                      return (
                        <li
                          key={label}
                          role="option"
                          aria-selected={active}
                          onClick={() => void handleSwitchNetwork(value)}
                          className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer text-gray-300 hover:bg-surface-700 hover:text-gray-100 transition-colors"
                        >
                          <span className={`h-2 w-2 rounded-full ${dot}`} />
                          <span className="flex-1">{label}</span>
                          {active && (
                            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-green-400">
                              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                            </svg>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="h-8 w-8 rounded-lg border border-surface-600 bg-surface-800 hover:bg-surface-700 flex items-center justify-center text-gray-400 hover:text-gray-200 transition-colors"
            >
              {theme === 'dark' ? (
                /* Sun icon */
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
              ) : (
                /* Moon icon */
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              )}
            </button>
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8 space-y-6">
        {/* Top-level page navigation */}
        <div className="flex gap-1 p-1 rounded-xl bg-surface-800 border border-surface-600 w-fit">
          {([
            { id: 'revoke', label: 'Revoke' },
            { id: 'shield', label: 'Shield Extension', badge: 'Soon' },
          ] as const).map((page) => (
            <button
              key={page.id}
              onClick={() => setActivePage(page.id)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activePage === page.id
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {page.label}
              {'badge' in page && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 leading-none">
                  {page.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {activePage === 'shield' ? (
          /* Shield Extension coming soon */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-20 w-20 rounded-2xl bg-surface-700 border border-surface-600 flex items-center justify-center mb-6">
              <svg viewBox="0 0 24 24" className="h-10 w-10 text-brand-400" fill="currentColor">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
              </svg>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs font-semibold mb-4">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
              Coming Soon
            </span>
            <h2 className="text-2xl font-bold text-gray-100 mb-3">OPRevoke Shield Extension</h2>
            <p className="text-gray-400 text-sm max-w-md mb-8">
              A browser extension that monitors your OP20 approvals in real time and alerts you
              before you sign risky transactions — protecting your wallet automatically.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl text-left">
              {[
                {
                  icon: (
                    <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand-400" fill="currentColor">
                      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l5 2.18V11c0 3.5-2.33 6.79-5 7.93-2.67-1.14-5-4.43-5-7.93V7.18L12 5z" />
                    </svg>
                  ),
                  title: 'Real-Time Alerts',
                  body: 'Get warned instantly when a dApp requests an unlimited approval.',
                },
                {
                  icon: (
                    <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand-400" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  ),
                  title: 'Approval Monitor',
                  body: 'Continuously tracks active allowances in the background.',
                },
                {
                  icon: (
                    <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand-400" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  ),
                  title: 'One-Click Revoke',
                  body: 'Revoke suspicious approvals directly from the extension popup.',
                },
              ].map((card) => (
                <div key={card.title} className="rounded-xl border border-surface-600 bg-surface-800 p-4">
                  <div className="mb-2">{card.icon}</div>
                  <h3 className="font-semibold text-gray-200 text-sm mb-1">{card.title}</h3>
                  <p className="text-xs text-gray-500">{card.body}</p>
                </div>
              ))}
            </div>
          </div>
        ) : !isConnectedAndReady ? (
          /* Not connected */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="h-16 w-16 rounded-2xl bg-surface-700 border border-surface-600 flex items-center justify-center mb-6">
              <svg viewBox="0 0 24 24" className="h-8 w-8 text-gray-500" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-200 mb-2">Connect Your Wallet</h2>
            <p className="text-gray-400 text-sm max-w-sm">
              Connect your OPNet-compatible wallet to scan and revoke active token approvals.
            </p>
            <div className="mt-6">
              <ConnectButton />
            </div>

            {/* Info cards */}
            <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl text-left">
              {[
                {
                  icon: '🔍',
                  title: 'Scan Approvals',
                  body: 'See all OP20 token allowances you have granted to protocols.',
                },
                {
                  icon: '⚡',
                  title: 'One-Click Revoke',
                  body: 'Cancel any approval instantly with a single transaction.',
                },
                {
                  icon: '🔒',
                  title: 'Stay Secure',
                  body: 'Unlimited approvals are a security risk. Revoke what you no longer need.',
                },
              ].map((card) => (
                <div
                  key={card.title}
                  className="rounded-xl border border-surface-600 bg-surface-800 p-4"
                >
                  <div className="text-2xl mb-2">{card.icon}</div>
                  <h3 className="font-semibold text-gray-200 text-sm mb-1">{card.title}</h3>
                  <p className="text-xs text-gray-500">{card.body}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Connected — main dashboard */
          <>
            {/* Network banner */}
            {networkConfig && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                Connected to{' '}
                <a
                  href={networkConfig.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-400 hover:text-brand-300"
                >
                  {networkConfig.name}
                </a>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 p-1 rounded-xl bg-surface-800 border border-surface-600 w-fit">
              {(
                [
                  { id: 'known', label: 'Known Spenders' },
                  { id: 'custom', label: 'Custom Spenders' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-brand-500 text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab description + scan controls */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-200">Token Approvals</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {activeTab === 'known'
                    ? 'Scans all known OP20 tokens against hardcoded protocol spenders (MotoSwap, Staking, etc.).'
                    : 'Scans all known OP20 tokens against your custom spender addresses only.'}
                </p>
              </div>
              <Button
                variant="primary"
                onClick={handleScan}
                loading={scanning}
                disabled={scanning}
              >
                {scanning ? 'Scanning…' : 'Scan Approvals'}
              </Button>
            </div>

            {/* Post-scan summary */}
            {lastScan && !scanning && (
              <div className="rounded-xl border border-surface-600 bg-surface-800/60 px-4 py-3 flex flex-wrap gap-3 items-start text-xs text-gray-400">
                <span className="text-gray-300 font-medium">Last scan:</span>
                <span>{lastScan.tokenCount} token{lastScan.tokenCount !== 1 ? 's' : ''}</span>
                <span className="text-gray-600">·</span>
                <span>{lastScan.spenders.length} spender{lastScan.spenders.length !== 1 ? 's' : ''}</span>
                <span className="text-gray-600">·</span>
                <span>{entries.filter((e) => e.status !== 'revoked').length} active allowance{entries.filter((e) => e.status !== 'revoked').length !== 1 ? 's' : ''} found</span>
                {lastScan.mode === 'custom' && lastScan.spenders.length > 0 && (
                  <>
                    <span className="text-gray-600">·</span>
                    <span className="text-gray-500">
                      Scanned against:{' '}
                      {lastScan.spenders.map((s, i) => (
                        <span key={s.address}>
                          <span className="text-gray-300 font-mono">{s.name}</span>
                          {i < lastScan.spenders.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Per-token scan errors */}
            {scanErrors.length > 0 && !scanning && (
              <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 space-y-1">
                <p className="text-xs font-semibold text-red-400">
                  {scanErrors.length} token{scanErrors.length !== 1 ? 's' : ''} failed to scan — these may have active approvals that could not be checked:
                </p>
                <ul className="space-y-0.5">
                  {scanErrors.map((e) => (
                    <li key={e.address} className="text-xs text-red-300 font-mono flex gap-2">
                      <span className="font-semibold text-red-200 not-italic font-sans">{e.name}</span>
                      <span className="text-red-500 truncate">{e.error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Results table */}
            <AllowanceTable
              entries={entries}
              scanning={scanning}
              scanStatus={scanStatus}
              scanError={scanError}
              hasScan={lastScan !== null}
              explorerUrl={networkConfig?.explorerUrl ?? 'https://opscan.org'}
              mempoolUrl={networkConfig?.mempoolUrl ?? 'https://mempool.space/tx/'}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onSelectAll={handleSelectAll}
              onRevoke={(id) => void handleRevoke(id)}
              onRevokeSelected={() => void handleRevokeSelected()}
              bulkRevoking={bulkRevoking}
            />

            {/* Collapsible inputs — token input always shown; spender input only on custom tab */}
            <div className="space-y-3">
              <div>
                <button
                  onClick={() => setShowTokenInput((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-surface-600 bg-surface-800 hover:bg-surface-700 hover:border-surface-500 transition-colors text-sm font-medium text-gray-300"
                >
                  <span className="flex items-center gap-2">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-brand-400">
                      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                    Add a custom token to scan
                  </span>
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={`h-4 w-4 text-gray-500 transition-transform ${showTokenInput ? 'rotate-180' : ''}`}
                  >
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                {showTokenInput && (
                  <div className="mt-2">
                    <TokenInput
                      customTokens={customTokens}
                      provider={provider}
                      network={network}
                      onAdd={addCustomToken}
                      onRemove={removeCustomToken}
                    />
                  </div>
                )}
              </div>

              {activeTab === 'custom' && (
                <div>
                  <button
                    onClick={() => setShowSpenderInput((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-surface-600 bg-surface-800 hover:bg-surface-700 hover:border-surface-500 transition-colors text-sm font-medium text-gray-300"
                  >
                    <span className="flex items-center gap-2">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-brand-400">
                        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                      Add a custom spender to scan against
                    </span>
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className={`h-4 w-4 text-gray-500 transition-transform ${showSpenderInput ? 'rotate-180' : ''}`}
                    >
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                  {showSpenderInput && (
                    <div className="mt-2">
                      <SpenderInput
                        customSpenders={customSpenders}
                        onAdd={addCustomSpender}
                        onRemove={removeCustomSpender}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer note */}
            <p className="text-xs text-gray-600 text-center">
              OPRevoke only reads data from the blockchain. Revocations require wallet confirmation.
              Always verify transactions before signing.
            </p>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-surface-700 py-4">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between text-xs text-gray-600">
          <span>OPRevoke — Open source, non-custodial</span>
          <span>Built on OPNet Bitcoin Layer 1</span>
        </div>
      </footer>
    </div>
  );
}
