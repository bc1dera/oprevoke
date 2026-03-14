import { useState, useCallback, useEffect } from 'react';
import { BLOCKLIST_UPDATED_KEY } from '../shared/blocklists.js';
import type { AllowanceEntry, NetworkId } from '../shared/types.js';
import type {
  ScanAllowancesMsg,
  ScanAllowancesResponse,
  RefreshBlocklistMsg,
} from '../shared/messages.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const OPREVOKE_APP_URL = 'https://oprevoke.app';
const LS_ADDRESS = 'oprevoke:shield:address';
const LS_NETWORK = 'oprevoke:shield:network';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAllowance(allowance: string, decimals: number): string {
  const val = BigInt(allowance);
  const half = 2n ** 255n;
  if (val >= half) return '∞ Unlimited';
  const divisor = BigInt(10 ** decimals);
  const whole = val / divisor;
  const frac = val % divisor;
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, 4);
  return `${whole.toLocaleString()}.${fracStr}`;
}

function truncAddr(addr: string): string {
  return addr.length > 18 ? `${addr.slice(0, 10)}…${addr.slice(-6)}` : addr;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ShieldLogo({ size = 7 }: { size?: number }) {
  const px = size * 4;
  const iconPx = Math.round(px * 0.55);
  return (
    <div
      className="rounded-lg bg-brand-500 flex items-center justify-center flex-shrink-0"
      style={{ width: px, height: px }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="text-white"
        style={{ width: iconPx, height: iconPx }}
      >
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
      </svg>
    </div>
  );
}

function StatusDot({ active = true }: { active?: boolean }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 ${
        active ? 'bg-green-500' : 'bg-gray-600'
      }`}
    />
  );
}

// ── AllowancesTab ─────────────────────────────────────────────────────────────

function AllowancesTab({
  networkId,
  onNetworkChange,
}: {
  networkId: NetworkId;
  onNetworkChange: (id: NetworkId) => void;
}) {
  const [address, setAddress] = useState('');
  const [scanning, setScanning] = useState(false);
  const [entries, setEntries] = useState<AllowanceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore saved address on mount
  useEffect(() => {
    chrome.storage.local.get([LS_ADDRESS], (r) => {
      if (r[LS_ADDRESS]) setAddress(r[LS_ADDRESS] as string);
    });
  }, []);

  const handleAddressChange = (v: string) => {
    setAddress(v);
    chrome.storage.local.set({ [LS_ADDRESS]: v });
  };

  const scan = useCallback(async () => {
    const addr = address.trim();
    if (!addr) { setError('Enter a wallet address'); return; }
    setScanning(true);
    setError(null);
    setEntries(null);

    chrome.runtime.sendMessage<ScanAllowancesMsg, ScanAllowancesResponse>(
      { type: 'SCAN_ALLOWANCES', address: addr, networkId },
      (response) => {
        setScanning(false);
        if (chrome.runtime.lastError || !response) {
          setError(chrome.runtime.lastError?.message ?? 'Extension error');
          return;
        }
        if (response.error) { setError(response.error); return; }
        setEntries(response.entries);
      },
    );
  }, [address, networkId]);

  const openRevoke = (entry: AllowanceEntry) => {
    const url =
      `${OPREVOKE_APP_URL}/?token=${encodeURIComponent(entry.token.address)}` +
      `&spender=${encodeURIComponent(entry.spender.address)}` +
      `&network=${networkId}`;
    chrome.tabs.create({ url });
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Network + address row */}
      <div className="flex gap-2">
        <select
          value={networkId}
          onChange={(e) => onNetworkChange(e.target.value as NetworkId)}
          className="text-xs bg-surface-700 border border-surface-600 text-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:border-brand-500 flex-shrink-0"
        >
          <option value="mainnet">Mainnet</option>
          <option value="testnet">Testnet</option>
        </select>
        <input
          value={address}
          onChange={(e) => handleAddressChange(e.target.value)}
          placeholder="bc1q… or 0x… wallet address"
          className="flex-1 text-xs bg-surface-800 border border-surface-600 text-gray-200 rounded-lg px-3 py-2 placeholder:text-gray-600 focus:outline-none focus:border-brand-500 min-w-0"
          onKeyDown={(e) => { if (e.key === 'Enter') void scan(); }}
        />
        <button
          onClick={() => void scan()}
          disabled={scanning}
          className="px-3 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex-shrink-0"
        >
          {scanning ? (
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </span>
          ) : (
            'Scan'
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Scanning state */}
      {scanning && (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <div className="h-6 w-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-gray-500">Scanning allowances…</p>
        </div>
      )}

      {/* Empty result */}
      {entries !== null && entries.length === 0 && !scanning && (
        <div className="flex flex-col items-center py-10 text-center gap-2">
          <svg
            viewBox="0 0 24 24"
            className="h-8 w-8 text-green-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6
                 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623
                 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152
                 c-3.196 0-6.1-1.248-8.25-3.285z"
            />
          </svg>
          <p className="text-xs text-gray-400 font-medium">No active allowances found</p>
          <p className="text-xs text-gray-600">This wallet looks clean</p>
        </div>
      )}

      {/* Results */}
      {entries && entries.length > 0 && !scanning && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-gray-500 pb-0.5">
            {entries.length} active allowance{entries.length !== 1 ? 's' : ''} found
          </p>
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl border border-surface-600 bg-surface-800 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-semibold text-gray-100">
                      {entry.token.symbol}
                    </span>
                    <svg
                      viewBox="0 0 16 16"
                      className="h-3 w-3 text-gray-600 flex-shrink-0"
                      fill="currentColor"
                    >
                      <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
                    </svg>
                    <span className="text-xs text-gray-400 truncate">
                      {entry.spender.name}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-gray-500">
                    {formatAllowance(entry.allowance, entry.token.decimals)}
                  </div>
                  <div className="font-mono text-xs text-gray-700 mt-0.5">
                    {truncAddr(entry.spender.address)}
                  </div>
                </div>
                <button
                  onClick={() => openRevoke(entry)}
                  title="Open OPRevoke to revoke this allowance"
                  className="px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold rounded-lg transition-colors flex-shrink-0"
                >
                  Revoke ↗
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Idle state hint */}
      {entries === null && !scanning && !error && (
        <p className="text-xs text-gray-600 text-center py-6">
          Enter your wallet address and press <strong className="text-gray-500">Scan</strong>
        </p>
      )}
    </div>
  );
}

// ── SecurityTab ───────────────────────────────────────────────────────────────

function SecurityTab() {
  const [blocklistUpdatedAt, setBlocklistUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    chrome.storage.local.get([BLOCKLIST_UPDATED_KEY], (r) => {
      if (r[BLOCKLIST_UPDATED_KEY]) setBlocklistUpdatedAt(r[BLOCKLIST_UPDATED_KEY] as number);
    });
  }, []);

  const refresh = () => {
    setRefreshing(true);
    chrome.runtime.sendMessage<RefreshBlocklistMsg>({ type: 'REFRESH_BLOCKLIST' }, () => {
      setTimeout(() => {
        chrome.storage.local.get([BLOCKLIST_UPDATED_KEY], (r) => {
          if (r[BLOCKLIST_UPDATED_KEY]) setBlocklistUpdatedAt(r[BLOCKLIST_UPDATED_KEY] as number);
          setRefreshing(false);
        });
      }, 2_500);
    });
  };

  const protections = [
    {
      label: 'Phishing Site Alerts',
      desc: 'Checks every page you visit against the threat database.',
    },
    {
      label: 'Transaction Simulation',
      desc: 'Wraps window.opnet signing to flag risky calls before execution.',
    },
    {
      label: 'Malicious Token Detection',
      desc: 'Warns when a transaction involves a known drainer token.',
    },
    {
      label: 'Honeypot Token Warning',
      desc: 'Flags tokens that simulate successfully to buy but not sell.',
    },
    {
      label: 'Approval Monitor',
      desc: 'Scan your wallet for active allowances granted to spenders.',
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Threat DB card */}
      <div className="rounded-xl border border-surface-600 bg-surface-800 p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-gray-200">Threat Database</span>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="text-xs text-brand-400 hover:text-brand-500 disabled:opacity-50"
          >
            {refreshing ? 'Updating…' : 'Refresh'}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          {blocklistUpdatedAt
            ? `Last updated ${fmtDate(blocklistUpdatedAt)}`
            : 'Not yet fetched — click Refresh'}
        </p>
      </div>

      {/* Protection list */}
      <div className="flex flex-col gap-1.5">
        {protections.map((p) => (
          <div
            key={p.label}
            className="flex items-start gap-3 rounded-xl border border-surface-600 bg-surface-800 p-3"
          >
            <StatusDot active />
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-200">{p.label}</p>
              <p className="text-xs text-gray-600 mt-0.5">{p.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Popup ─────────────────────────────────────────────────────────────────────

type Tab = 'allowances' | 'security';

export function Popup() {
  const [activeTab, setActiveTab] = useState<Tab>('allowances');
  const [networkId, setNetworkId] = useState<NetworkId>('mainnet');

  // Restore saved network on mount
  useEffect(() => {
    chrome.storage.local.get([LS_NETWORK], (r) => {
      if (r[LS_NETWORK]) setNetworkId(r[LS_NETWORK] as NetworkId);
    });
  }, []);

  const handleNetworkChange = (id: NetworkId) => {
    setNetworkId(id);
    chrome.storage.local.set({ [LS_NETWORK]: id });
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'allowances', label: 'Allowances' },
    { id: 'security', label: 'Security' },
  ];

  return (
    <div className="flex flex-col min-h-[500px] max-h-[600px] bg-surface-900 text-gray-100">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-surface-700 flex-shrink-0">
        <ShieldLogo size={7} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-100 leading-tight">OPRevoke Shield</p>
          <p className="text-xs text-gray-600 leading-tight">OP20 wallet protection</p>
        </div>
        <button
          onClick={() => chrome.tabs.create({ url: OPREVOKE_APP_URL })}
          className="text-xs text-brand-400 hover:text-brand-500 flex-shrink-0"
          title="Open OPRevoke web app"
        >
          Web App ↗
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-700 flex-shrink-0">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              activeTab === id
                ? 'text-brand-400 border-b-2 border-brand-500 -mb-px'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'allowances' && (
          <AllowancesTab networkId={networkId} onNetworkChange={handleNetworkChange} />
        )}
        {activeTab === 'security' && <SecurityTab />}
      </div>
    </div>
  );
}
