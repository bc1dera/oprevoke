// Content script — isolated world
// Responsibilities:
//   1. Phishing detection: check current domain → show warning banner
//   2. Relay window.postMessage events from the MAIN-world injector to background
//      and post responses back so the injector can act on them.

import type {
  CheckPhishingMsg,
  CheckPhishingResponse,
  TxCheckResponse,
} from '../shared/messages.js';

// ── 1. Phishing check ─────────────────────────────────────────────────────────

const domain = location.hostname.replace(/^www\./, '');

chrome.runtime.sendMessage<CheckPhishingMsg, CheckPhishingResponse>(
  { type: 'CHECK_PHISHING', domain },
  (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.isPhishing) showPhishingBanner(domain, response.reason);
  },
);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c),
  );
}

function showPhishingBanner(siteDomain: string, reason?: string): void {
  if (document.getElementById('oprevoke-phishing-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'oprevoke-phishing-banner';
  banner.setAttribute(
    'style',
    [
      'position:fixed',
      'top:0',
      'left:0',
      'right:0',
      'z-index:2147483647',
      'background:#dc2626',
      'color:#fff',
      'font-family:-apple-system,system-ui,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:14px',
      'padding:12px 16px',
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:12px',
      'box-shadow:0 2px 12px rgba(0,0,0,0.4)',
      'line-height:1.4',
    ].join(';'),
  );

  banner.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px;flex:1;min-width:0">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:1px">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94
             a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      </svg>
      <span>
        <strong>OPRevoke Shield — Phishing Warning:</strong>
        <strong>${escapeHtml(siteDomain)}</strong> is a known phishing site.
        ${reason ? escapeHtml(reason) + '. ' : ''}
        Do <strong>not</strong> connect your wallet or sign any transactions here.
      </span>
    </div>
    <button id="oprevoke-dismiss-btn"
      style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);
             color:#fff;padding:4px 12px;border-radius:4px;cursor:pointer;
             font-size:13px;flex-shrink:0;white-space:nowrap">
      Dismiss
    </button>
  `;

  document.documentElement.prepend(banner);
  document.getElementById('oprevoke-dismiss-btn')?.addEventListener('click', () => banner.remove());
}

// ── 2. Relay injector ↔ background messages ────────────────────────────────────
// The MAIN-world injector posts { __oprevoke: true, ...payload } via window.postMessage.
// This isolated-world script forwards it to the background and posts the response back.

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as Record<string, unknown> | null;
  if (!data || data['__oprevoke'] !== true) return;

  const { __oprevoke: _flag, ...msg } = data;

  chrome.runtime.sendMessage(msg, (response: TxCheckResponse | undefined) => {
    if (chrome.runtime.lastError) {
      window.postMessage({ __oprevoke_response: true, isRisky: false, warnings: [] }, '*');
      return;
    }
    window.postMessage({ __oprevoke_response: true, ...(response ?? {}) }, '*');
  });
});
