import type { AllowanceEntry } from '../../types/index.js';

// u256 max — anything above half of max is treated as "Unlimited"
const UNLIMITED_THRESHOLD = 2n ** 200n;

function formatAllowance(amount: bigint, decimals: number): string {
  if (amount >= UNLIMITED_THRESHOLD) return 'Unlimited';
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, 6);
  return `${whole.toLocaleString()}.${fracStr}`;
}

function shortAddr(addr: string): string {
  if (addr.startsWith('0x')) return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

interface AllowanceRowProps {
  entry: AllowanceEntry;
  explorerUrl: string;
  mempoolUrl: string;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onRevoke: (id: string) => void;
}

export function AllowanceRow({
  entry,
  explorerUrl,
  mempoolUrl,
  selected,
  onSelect,
  onRevoke,
}: AllowanceRowProps) {
  const { token, spender, allowance, status } = entry;
  const isUnlimited = allowance >= UNLIMITED_THRESHOLD;
  const isRevoked = status === 'revoked';
  const isSelectable = !isRevoked;

  return (
    <tr
      className={`border-b border-surface-700 transition-colors ${
        selected ? 'bg-brand-900/20' : 'hover:bg-surface-700/40'
      }`}
    >
      {/* Checkbox */}
      <td className="pl-4 pr-2 py-3 w-8">
        {isSelectable ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(entry.id, e.target.checked)}
            className="h-4 w-4 rounded border-surface-500 bg-surface-700 text-brand-500 focus:ring-brand-500 focus:ring-offset-surface-900 cursor-pointer"
            aria-label={`Select ${token.symbol} / ${spender.name}`}
          />
        ) : (
          <span className="block h-4 w-4" />
        )}
      </td>

      {/* Token */}
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-semibold text-gray-100">{token.symbol}</span>
          <span className="text-xs text-gray-500 font-mono">{shortAddr(token.address)}</span>
        </div>
      </td>

      {/* Spender */}
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-semibold text-gray-200">{spender.name}</span>
          <span className="text-xs text-gray-500">{spender.description}</span>
          <a
            href={`${explorerUrl}/accounts/${spender.address}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-mono text-brand-400 hover:text-brand-300 transition-colors mt-0.5"
          >
            {shortAddr(spender.address)}
          </a>
        </div>
      </td>

      {/* Allowance */}
      <td className="px-4 py-3">
        <span
          className={`font-mono text-sm font-semibold ${
            isUnlimited ? 'text-red-400' : 'text-yellow-300'
          }`}
        >
          {formatAllowance(allowance, token.decimals)}{' '}
          <span className="text-xs font-normal text-gray-500">{token.symbol}</span>
        </span>
      </td>

      {/* Risk badge */}
      <td className="px-4 py-3">
        {isUnlimited ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/50 text-red-300 border border-red-800">
            High Risk
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-900/50 text-yellow-300 border border-yellow-800">
            Limited
          </span>
        )}
      </td>

      {/* Action */}
      <td className="px-4 py-3 text-right">
        {status === 'revoked' ? (
          <div className="flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1 text-xs text-green-400 font-medium">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              Revoked
            </span>
            {entry.txId && (
              <div className="flex items-center gap-2 mt-0.5">
                <a
                  href={`${explorerUrl}/transactions/${entry.txId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
                  title={entry.txId}
                >
                  OPScan ↗
                </a>
                <span className="text-gray-600 text-xs">·</span>
                <a
                  href={`${mempoolUrl}${entry.txId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
                  title={entry.txId}
                >
                  Mempool ↗
                </a>
              </div>
            )}
          </div>
        ) : status === 'error' ? (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => onRevoke(entry.id)}
              className="text-xs text-red-400 hover:text-red-300 font-medium"
            >
              Retry
            </button>
            <span className="text-xs text-red-500 max-w-[140px] text-right truncate">
              {entry.errorMessage}
            </span>
          </div>
        ) : (
          <button
            onClick={() => onRevoke(entry.id)}
            disabled={status === 'revoking'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-red-700 hover:bg-red-600 text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {status === 'revoking' && (
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            {status === 'revoking' ? 'Revoking…' : 'Revoke'}
          </button>
        )}
      </td>
    </tr>
  );
}
