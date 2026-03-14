import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';

// Lazy-load the entire app including WalletConnectProvider, OPNet SDK, and
// @btc-vision/* — defers the two ~1.2 MB chunks until after first paint.
const AppWithProvider = lazy(() => import('./AppWithProvider.js'));

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0a0a0a',
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              border: '3px solid #2a2a2a',
              borderTop: '3px solid #f97316',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      }
    >
      <AppWithProvider />
    </Suspense>
  </StrictMode>,
);
