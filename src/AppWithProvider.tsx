import { WalletConnectProvider } from '@btc-vision/walletconnect';
import App from './App.js';

export default function AppWithProvider() {
  return (
    <WalletConnectProvider theme="dark">
      <App />
    </WalletConnectProvider>
  );
}
