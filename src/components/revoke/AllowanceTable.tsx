import type { AllowanceEntry } from '../../types/index.js';
import { AllowanceRow } from './AllowanceRow.js';
import { Spinner } from '../common/Spinner.js';

interface AllowanceTableProps {
  entries: AllowanceEntry[];
  scanning: boolean;
  scanStatus: string | null;
  scanError: string | null;
  hasScan: boolean;
  explorerUrl: string;
  mempoolUrl: string;
  selectedIds: Set<string>;
  bulkRevoking: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  onRevoke: (id: string) => void;
  onRevokeSelected: () => void;
}

export function AllowanceTable({
  entries,
  scanning,
  scanStatus,
  scanError,
  hasScan,
  explorerUrl,
  mempoolUrl,
  selectedIds,
  bulkRevoking,
  onSelect,
  onSelectAll,
  onRevoke,
  onRevokeSelected,
}: AllowanceTableProps) {
  if (scanning) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Spinner size="lg" label={scanStatus ?? 'Scanning for active approvals…'} />
      </div>
    );
  }

  if (scanError) {
    return (
      <div className="rounded-xl border border-yellow-800 bg-yellow-900/20 p-6 text-center">
        <p className="text-yellow-300 text-sm">{scanError}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    if (!hasScan) {
      return (
        <div className="rounded-xl border border-surface-600 bg-surface-800 p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-600 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <p className="text-gray-400 font-medium">No scan yet</p>
          <p className="text-gray-500 text-sm mt-1">
            Click <span className="text-gray-300 font-medium">Scan Approvals</span> to check for active token allowances.
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-surface-600 bg-surface-800 p-12 text-center">
        <svg
          className="mx-auto h-12 w-12 text-gray-600 mb-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
        <p className="text-gray-400 font-medium">No active approvals found</p>
        <p className="text-gray-500 text-sm mt-1">
          Your wallet has no outstanding token approvals on the scanned contracts.
        </p>
      </div>
    );
  }

  const activeEntries = entries.filter((e) => e.status !== 'revoked');
  const allSelected =
    activeEntries.length > 0 && activeEntries.every((e) => selectedIds.has(e.id));
  const someSelected = activeEntries.some((e) => selectedIds.has(e.id));
  const selectedCount = activeEntries.filter((e) => selectedIds.has(e.id)).length;
  const activeCount = activeEntries.length;

  return (
    <div className="rounded-xl border border-surface-600 bg-surface-800 overflow-hidden">
      {/* Table toolbar */}
      <div className="px-4 py-3 border-b border-surface-600 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-300">Active Approvals</h3>
          <span className="text-xs font-mono text-gray-500">
            {activeCount} of {entries.length} active
          </span>
        </div>

        {/* Bulk revoke controls — always visible when entries exist */}
        {activeCount > 0 && (
          <div className="flex items-center gap-2">
            {selectedCount === 0 && (
              <span className="text-xs text-gray-500 italic">
                Select rows to batch revoke
              </span>
            )}
            <button
              onClick={onRevokeSelected}
              disabled={selectedCount === 0 || bulkRevoking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-red-700 hover:bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {bulkRevoking && (
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
              {bulkRevoking
                ? 'Revoking…'
                : selectedCount > 0
                  ? `Revoke Selected (${selectedCount})`
                  : 'Revoke Selected'}
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-700 text-xs text-gray-500 uppercase tracking-wider">
              {/* Select-all checkbox */}
              <th className="pl-4 pr-2 py-2 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={(e) => onSelectAll(e.target.checked)}
                  className="h-4 w-4 rounded border-surface-500 bg-surface-700 text-brand-500 focus:ring-brand-500 focus:ring-offset-surface-900 cursor-pointer"
                  aria-label="Select all"
                  disabled={activeEntries.length === 0}
                />
              </th>
              <th className="px-4 py-2 text-left font-medium">Token</th>
              <th className="px-4 py-2 text-left font-medium">Approved Spender</th>
              <th className="px-4 py-2 text-left font-medium">Allowance</th>
              <th className="px-4 py-2 text-left font-medium">Risk</th>
              <th className="px-4 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <AllowanceRow
                key={entry.id}
                entry={entry}
                explorerUrl={explorerUrl}
                mempoolUrl={mempoolUrl}
                selected={selectedIds.has(entry.id)}
                onSelect={onSelect}
                onRevoke={onRevoke}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
