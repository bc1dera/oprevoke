import { getContract, IOP20Contract, OP_20_ABI, JSONRpcProvider } from 'opnet';
import { Address } from '@btc-vision/transaction';
import {
  isDomainPhishing,
  isTokenMalicious,
  isTokenHoneypot,
  BLOCKLIST_STORAGE_KEY,
  BLOCKLIST_UPDATED_KEY,
  REMOTE_BLOCKLIST_URL,
  type BlocklistData,
} from '../shared/blocklists.js';
import { networkFromId, rpcUrlFromId } from '../shared/networks.js';
import { getKnownTokens, getKnownSpenders } from '../shared/contracts.js';
import type {
  ExtensionMessage,
  ScanAllowancesResponse,
  CheckPhishingResponse,
  TxCheckResponse,
  TokenCheckResponse,
} from '../shared/messages.js';
import type { AllowanceEntry } from '../shared/types.js';

// ── Blocklist ─────────────────────────────────────────────────────────────────

async function loadBlocklist(): Promise<BlocklistData | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([BLOCKLIST_STORAGE_KEY], (result) => {
      resolve((result[BLOCKLIST_STORAGE_KEY] as BlocklistData) ?? null);
    });
  });
}

async function fetchAndCacheBlocklist(): Promise<void> {
  try {
    const res = await fetch(REMOTE_BLOCKLIST_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return;
    const data = (await res.json()) as Omit<BlocklistData, 'updatedAt'>;
    const full: BlocklistData = { ...data, updatedAt: Date.now() };
    chrome.storage.local.set({
      [BLOCKLIST_STORAGE_KEY]: full,
      [BLOCKLIST_UPDATED_KEY]: Date.now(),
    });
  } catch {
    // Network unavailable — keep seed list
  }
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function setBadgeWarning(tabId: number): void {
  chrome.action.setBadgeText({ text: '!', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
}

function clearBadge(tabId: number): void {
  chrome.action.setBadgeText({ text: '', tabId });
}

// ── Scan allowances ───────────────────────────────────────────────────────────

async function scanAllowances(
  address: string,
  networkId: 'mainnet' | 'testnet',
): Promise<ScanAllowancesResponse> {
  try {
    const network = networkFromId(networkId);
    const rpcUrl = rpcUrlFromId(networkId);
    const provider = new JSONRpcProvider({ url: rpcUrl, network });

    const userAddress = Address.fromString(address);
    const tokens = getKnownTokens(network);
    const spenders = getKnownSpenders(network);

    const results: AllowanceEntry[] = [];

    await Promise.allSettled(
      tokens.map(async (token) => {
        const contract = getContract<IOP20Contract>(
          token.address,
          OP_20_ABI,
          provider,
          network,
        );
        contract.setSender(userAddress);

        await Promise.allSettled(
          spenders.map(async (spender) => {
            const spenderAddr = Address.fromString(spender.address);
            const result = await contract.allowance(userAddress, spenderAddr);
            const remaining = result.properties.remaining;
            if (remaining > 0n) {
              results.push({
                id: `${token.address.toLowerCase()}:${spender.address.toLowerCase()}`,
                token,
                spender,
                allowance: remaining.toString(),
                status: 'idle',
              });
            }
          }),
        );
      }),
    );

    return { entries: results };
  } catch (e) {
    return {
      entries: [],
      error: e instanceof Error ? e.message : 'Scan failed',
    };
  }
}

// ── Install / startup ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  void fetchAndCacheBlocklist();
  chrome.alarms.create('refreshBlocklist', { periodInMinutes: 24 * 60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshBlocklist') void fetchAndCacheBlocklist();
});

// ── Message handling ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    // ── Phishing check ──────────────────────────────────────────────────────
    if (message.type === 'CHECK_PHISHING') {
      void (async () => {
        const bl = await loadBlocklist();
        const extra = bl?.phishingDomains ?? [];
        const isPhishing = isDomainPhishing(message.domain, extra);
        if (isPhishing && sender.tab?.id) setBadgeWarning(sender.tab.id);
        const resp: CheckPhishingResponse = {
          isPhishing,
          reason: isPhishing ? 'Known phishing domain' : undefined,
        };
        sendResponse(resp);
      })();
      return true;
    }

    // ── Allowance scan ──────────────────────────────────────────────────────
    if (message.type === 'SCAN_ALLOWANCES') {
      void (async () => {
        const resp = await scanAllowances(message.address, message.networkId);
        sendResponse(resp);
      })();
      return true;
    }

    // ── Transaction interception check ──────────────────────────────────────
    if (message.type === 'TX_INTERCEPTED') {
      void (async () => {
        const bl = await loadBlocklist();
        const extraMalicious = bl?.maliciousTokens ?? [];
        const extraHoneypots = bl?.honeypotTokens ?? [];

        const warnings: string[] = [];
        const txStr = JSON.stringify(message.args).toLowerCase();

        // Scan tx data for known bad token addresses
        for (const addr of [...extraMalicious]) {
          if (txStr.includes(addr.toLowerCase())) {
            warnings.push(
              `Transaction involves a known malicious token (${addr.slice(0, 10)}…). This token may drain your wallet.`,
            );
          }
        }
        for (const addr of [...extraHoneypots]) {
          if (txStr.includes(addr.toLowerCase())) {
            warnings.push(
              `Transaction involves a known honeypot token (${addr.slice(0, 10)}…). You may not be able to sell this token after buying.`,
            );
          }
        }

        const resp: TxCheckResponse = {
          isRisky: warnings.length > 0,
          warnings,
        };
        sendResponse(resp);
      })();
      return true;
    }

    // ── Token check ─────────────────────────────────────────────────────────
    if (message.type === 'TOKEN_CHECK') {
      void (async () => {
        const bl = await loadBlocklist();
        const resp: TokenCheckResponse = {
          malicious: isTokenMalicious(message.tokenAddress, bl?.maliciousTokens ?? []),
          honeypot: isTokenHoneypot(message.tokenAddress, bl?.honeypotTokens ?? []),
        };
        sendResponse(resp);
      })();
      return true;
    }

    // ── Blocklist refresh ───────────────────────────────────────────────────
    if (message.type === 'REFRESH_BLOCKLIST') {
      void fetchAndCacheBlocklist();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  },
);

// ── Tab navigation: clear badge on safe pages ─────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' || !tab.url) return;
  try {
    const domain = new URL(tab.url).hostname;
    void (async () => {
      const bl = await loadBlocklist();
      if (!isDomainPhishing(domain, bl?.phishingDomains ?? [])) clearBadge(tabId);
    })();
  } catch {
    // chrome://, about:, etc.
  }
});
