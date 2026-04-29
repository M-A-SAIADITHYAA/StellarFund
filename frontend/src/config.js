/**
 * StellarFund Configuration
 * Update CONTRACT_ID after deploying your contract
 */

export const CONFIG = {
  // ---- Network ----
  NETWORK: 'TESTNET',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  HORIZON_URL: 'https://horizon-testnet.stellar.org',
  SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org:443',
  FRIENDBOT_URL: 'https://friendbot.stellar.org',

  // ---- Contract ----
  // Replace with your deployed contract ID from contract-id.txt
  CONTRACT_ID: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',

  // Native XLM SAC wrapper on testnet
  XLM_SAC: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',

  // ---- Campaign Defaults (used before contract state loads) ----
  DEFAULT_GOAL: 1000,       // XLM
  DEFAULT_DEADLINE_DAYS: 7,

  // ---- Polling ----
  POLL_INTERVAL_MS: 5000,   // 5 seconds
  TX_POLL_INTERVAL_MS: 2000, // 2 seconds for tx confirmation

  // ---- Explorer ----
  EXPLORER_URL: 'https://stellar.expert/explorer/testnet',
};

/**
 * Convert stroops to XLM (1 XLM = 10,000,000 stroops)
 */
export function stroopsToXLM(stroops) {
  return Number(stroops) / 10_000_000;
}

/**
 * Convert XLM to stroops
 */
export function xlmToStroops(xlm) {
  return BigInt(Math.floor(Number(xlm) * 10_000_000));
}

/**
 * Truncate address for display
 */
export function truncateAddress(address, start = 6, end = 4) {
  if (!address || address.length < start + end) return address || '';
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

/**
 * Format XLM amount with commas
 */
export function formatXLM(amount) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}
