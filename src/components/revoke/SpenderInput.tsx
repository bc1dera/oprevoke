import { useState, type FormEvent } from 'react';
import { Button } from '../common/Button.js';
import type { SpenderInfo } from '../../types/index.js';

interface SpenderInputProps {
  customSpenders: SpenderInfo[];
  onAdd: (address: string, name: string) => void;
  onRemove: (address: string) => void;
}

export function SpenderInput({
  customSpenders,
  onAdd,
  onRemove,
}: SpenderInputProps) {
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedAddr = address.trim();
    const trimmedName = name.trim() || trimmedAddr.slice(0, 10) + '…';

    if (!trimmedAddr) return;

    const isHex = trimmedAddr.startsWith('0x') && trimmedAddr.length === 66;

    if (!isHex) {
      setError('Enter the contract address in 0x hex format (0x + 64 hex chars). Bech32 (op1…) addresses cannot be used for allowance queries.');
      return;
    }

    onAdd(trimmedAddr, trimmedName);
    setAddress('');
    setName('');
  };

  return (
    <div className="rounded-xl border border-surface-600 bg-surface-800 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Add Custom Spender</h3>
      <p className="text-xs text-gray-500 mb-3">
        Add a DEX, staking, or other contract address you may have approved tokens for.
      </p>

      <form onSubmit={handleSubmit} className="space-y-2">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x… spender contract address (32-byte hex)"
          className="w-full bg-surface-700 border border-surface-500 rounded-lg px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-500 focus:outline-none focus:border-brand-500 transition-colors"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Label (e.g. NativeSwap)"
            className="flex-1 bg-surface-700 border border-surface-500 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-brand-500 transition-colors"
          />
          <Button type="submit" variant="outline" size="sm">
            Add
          </Button>
        </div>
      </form>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {customSpenders.length > 0 && (
        <ul className="mt-4 space-y-2">
          {customSpenders.map((s) => (
            <li
              key={s.address}
              className="flex items-center justify-between text-sm text-gray-300"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-gray-200 flex-shrink-0">{s.name}</span>
                <span className="font-mono text-xs text-gray-500 truncate">{s.address}</span>
              </div>
              <button
                onClick={() => onRemove(s.address)}
                className="ml-3 text-xs text-red-400 hover:text-red-300 flex-shrink-0"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
