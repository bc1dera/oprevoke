import { useState, type FormEvent } from 'react';
import { AddressVerificator } from '@btc-vision/transaction';
import type { AbstractRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { Button } from '../common/Button.js';
import type { TokenInfo } from '../../types/index.js';

interface TokenInputProps {
  customTokens: TokenInfo[];
  provider: AbstractRpcProvider;
  network: Network;
  onAdd: (address: string, provider: AbstractRpcProvider, network: Network) => void;
  onRemove: (address: string) => void;
}

export function TokenInput({
  customTokens,
  provider,
  network,
  onAdd,
  onRemove,
}: TokenInputProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = value.trim();
    if (!trimmed) return;

    // Accept op1... addresses or 0x... hex addresses
    const isOp1 = AddressVerificator.isValidP2OPAddress(trimmed, network);
    const isHex = trimmed.startsWith('0x') && trimmed.length === 66;

    if (!isOp1 && !isHex) {
      setError('Enter a valid OPNet contract address (op1… or 0x…)');
      return;
    }

    onAdd(trimmed, provider, network);
    setValue('');
  };

  return (
    <div className="rounded-xl border border-surface-600 bg-surface-800 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Add Custom Token</h3>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="op1… or 0x… token contract address"
          className="flex-1 bg-surface-700 border border-surface-500 rounded-lg px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-500 focus:outline-none focus:border-brand-500 transition-colors"
        />
        <Button type="submit" variant="outline" size="sm">
          Add
        </Button>
      </form>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {customTokens.length > 0 && (
        <ul className="mt-4 space-y-2">
          {customTokens.map((t) => (
            <li
              key={t.address}
              className="flex items-center justify-between text-sm text-gray-300"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-gray-200 flex-shrink-0">{t.symbol}</span>
                <span className="font-mono text-xs text-gray-500 truncate">{t.address}</span>
              </div>
              <button
                onClick={() => onRemove(t.address)}
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
