// Injector — MAIN world content script (world: "MAIN" in manifest)
// Wraps window.opnet signing methods to intercept transactions before
// they reach the wallet, running a risk check via the background worker
// (relayed through the isolated-world content script).
// No chrome.* APIs are available here — communication is via window.postMessage.

(function shield() {
  const SIGNING_METHODS = [
    'signTransaction',
    'sendTransaction',
    'signPsbt',
    'sendBitcoin',
    'signMessage',
  ] as const;

  // ── IPC with isolated-world content script ──────────────────────────────────

  function sendToExtension(
    payload: Record<string, unknown>,
  ): Promise<{ isRisky: boolean; warnings: string[] }> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ isRisky: false, warnings: [] });
      }, 3_000);

      function handler(event: MessageEvent) {
        if (event.source !== window) return;
        const d = event.data as Record<string, unknown> | null;
        if (!d || d['__oprevoke_response'] !== true) return;
        clearTimeout(timeoutId);
        window.removeEventListener('message', handler);
        resolve({
          isRisky: Boolean(d['isRisky']),
          warnings: Array.isArray(d['warnings']) ? (d['warnings'] as string[]) : [],
        });
      }

      window.addEventListener('message', handler);
      window.postMessage({ __oprevoke: true, ...payload }, '*');
    });
  }

  // ── Risk warning overlay ────────────────────────────────────────────────────

  function showRiskWarning(
    method: string,
    warnings: string[],
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.setAttribute(
        'style',
        'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.75);' +
          'display:flex;align-items:center;justify-content:center;' +
          'font-family:-apple-system,system-ui,sans-serif',
      );

      const warningItems = warnings
        .map(
          (w) =>
            `<li style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;
                background:#2d1111;border-radius:6px;margin-bottom:6px;font-size:13px;color:#fca5a5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#ef4444" style="flex-shrink:0;margin-top:1px">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4m0 4h.01" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <span>${w.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
            </li>`,
        )
        .join('');

      overlay.innerHTML = `
        <div style="background:#111;border:1px solid #ef4444;border-radius:14px;
                    padding:24px;max-width:440px;width:92%;color:#e5e7eb;
                    box-shadow:0 8px 32px rgba(0,0,0,0.6)">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
            <div style="background:#f97316;border-radius:8px;width:32px;height:32px;
                        display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
              </svg>
            </div>
            <div>
              <div style="font-size:15px;font-weight:700;color:#ef4444">Transaction Risk Detected</div>
              <div style="font-size:12px;color:#6b7280">OPRevoke Shield intercepted
                <strong style="color:#d1d5db">${method}</strong>
              </div>
            </div>
          </div>
          <ul style="margin:0 0 18px;padding:0;list-style:none">
            ${warningItems}
          </ul>
          <p style="font-size:12px;color:#6b7280;margin:0 0 16px">
            Review the risks above carefully before proceeding. Cancelling is the safe choice.
          </p>
          <div style="display:flex;gap:10px">
            <button id="opr-cancel-btn"
              style="flex:1;padding:11px;background:#374151;border:none;color:#e5e7eb;
                     border-radius:8px;cursor:pointer;font-size:14px;font-weight:600">
              Cancel
            </button>
            <button id="opr-proceed-btn"
              style="flex:1;padding:11px;background:#450a0a;border:1px solid #ef4444;
                     color:#fca5a5;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600">
              Proceed Anyway
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      document.getElementById('opr-cancel-btn')?.addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
      document.getElementById('opr-proceed-btn')?.addEventListener('click', () => {
        overlay.remove();
        resolve(true);
      });
    });
  }

  // ── Intercept window.opnet ────────────────────────────────────────────────

  function patchOpnet(opnet: Record<string, unknown>): void {
    for (const method of SIGNING_METHODS) {
      if (typeof opnet[method] !== 'function') continue;

      const original = opnet[method] as (...args: unknown[]) => Promise<unknown>;

      opnet[method] = async function oprevokeSigned(...args: unknown[]) {
        try {
          // Serialise args — strip BigInt so JSON.stringify works
          const serialised = JSON.parse(
            JSON.stringify(args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
          ) as unknown[];

          const result = await sendToExtension({
            type: 'TX_INTERCEPTED',
            method,
            args: serialised,
          });

          if (result.isRisky) {
            const proceed = await showRiskWarning(method, result.warnings);
            if (!proceed) {
              throw new Error('[OPRevoke Shield] Transaction blocked by user after risk warning.');
            }
          }
        } catch (err) {
          // Re-throw our own block errors; swallow simulation failures
          if (err instanceof Error && err.message.startsWith('[OPRevoke Shield]')) throw err;
          console.warn('[OPRevoke Shield] Risk check error (non-blocking):', err);
        }

        return original.apply(this, args);
      };
    }
    console.log('[OPRevoke Shield] Transaction interceptor active on window.opnet');
  }

  // ── Wait for wallet injection ─────────────────────────────────────────────

  function waitAndPatch(retries = 30): void {
    const win = window as unknown as Record<string, unknown>;
    if (win['opnet'] && typeof win['opnet'] === 'object') {
      patchOpnet(win['opnet'] as Record<string, unknown>);
      return;
    }
    if (retries > 0) setTimeout(() => waitAndPatch(retries - 1), 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitAndPatch());
  } else {
    waitAndPatch();
  }
})();
