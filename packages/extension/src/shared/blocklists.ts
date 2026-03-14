// ── Seed blocklists (hardcoded) ───────────────────────────────────────────────
// In production these are supplemented by a periodically-fetched remote list.

export const SEED_PHISHING_DOMAINS: ReadonlySet<string> = new Set([
  'opnet-airdrop.com',
  'oprevoke-claim.com',
  'motoswap-airdrop.io',
  'btcvision-wallet.com',
  'opnet-staking-rewards.com',
  'claim-moto.com',
  'opnet-bonus.io',
  'opnet-rewards.com',
  'moto-airdrop.net',
]);

/** Token addresses known to drain wallets when swapped */
export const SEED_MALICIOUS_TOKENS: ReadonlySet<string> = new Set<string>([
  // Populated as drainer tokens are discovered and reported
]);

/** Token addresses that can be bought but not sold (honeypots) */
export const SEED_HONEYPOT_TOKENS: ReadonlySet<string> = new Set<string>([
  // Populated as honeypots are discovered
]);

// ── Storage keys ──────────────────────────────────────────────────────────────

export const BLOCKLIST_STORAGE_KEY = 'oprevoke:shield:blocklist';
export const BLOCKLIST_UPDATED_KEY = 'oprevoke:shield:blocklist_updated';
export const BLOCKLIST_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

// Replace with actual hosted URL when available
export const REMOTE_BLOCKLIST_URL =
  'https://raw.githubusercontent.com/bc1dera/oprevoke/main/blocklist/blocklist.json';

export interface BlocklistData {
  phishingDomains: string[];
  maliciousTokens: string[];
  honeypotTokens: string[];
  updatedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isDomainPhishing(domain: string, extra: string[] = []): boolean {
  const needle = domain.toLowerCase().replace(/^www\./, '');
  const all = [...SEED_PHISHING_DOMAINS, ...extra];
  return all.some((bad) => needle === bad || needle.endsWith(`.${bad}`));
}

export function isTokenMalicious(address: string, extra: string[] = []): boolean {
  const lc = address.toLowerCase();
  return (
    SEED_MALICIOUS_TOKENS.has(lc) || extra.some((t) => t.toLowerCase() === lc)
  );
}

export function isTokenHoneypot(address: string, extra: string[] = []): boolean {
  const lc = address.toLowerCase();
  return (
    SEED_HONEYPOT_TOKENS.has(lc) || extra.some((t) => t.toLowerCase() === lc)
  );
}
