import { useWalletConnect } from '@btc-vision/walletconnect';
import { Button } from '../common/Button.js';

function shortAddr(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export function ConnectButton() {
  const { walletAddress, connecting, openConnectModal, disconnect, network, walletBalance } =
    useWalletConnect();

  if (connecting) {
    return (
      <Button variant="outline" loading>
        Connecting…
      </Button>
    );
  }

  if (walletAddress) {
    const networkName = (network as { network?: string } | null)?.network ?? 'mainnet';
    const balanceSats = walletBalance?.confirmed ?? 0;
    const balanceBtc = (balanceSats / 1e8).toFixed(6);

    return (
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex flex-col items-end">
          <span className="text-xs text-gray-400 capitalize">{networkName}</span>
          <span className="text-xs font-mono text-gray-300">{balanceBtc} BTC</span>
        </div>
        <div className="flex items-center gap-2 bg-surface-700 border border-surface-600 rounded-lg px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-green-400 flex-shrink-0" />
          <span className="text-sm font-mono text-gray-200">{shortAddr(walletAddress)}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <Button variant="primary" onClick={openConnectModal}>
      Connect Wallet
    </Button>
  );
}
