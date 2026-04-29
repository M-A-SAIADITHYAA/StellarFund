/**
 * StellarFund — Main Entry Point
 * Initializes wallet, UI, and polling
 */

import './styles/index.css';
import { initWallet } from './wallet.js';
import { setupWalletUI, setDefaultUI } from './ui.js';
import { startPolling } from './poller.js';

async function main() {
  console.log('🚀 StellarFund — Crowdfunding on Stellar');
  console.log('   Network: TESTNET');

  // 1. Set default UI state
  setDefaultUI();

  // 2. Initialize wallet (loads StellarWalletsKit or Freighter fallback)
  await initWallet();

  // 3. Set up wallet UI bindings
  setupWalletUI();

  // 4. Start polling for contract state
  startPolling();

  console.log('✅ App initialized');
}

// Boot
main().catch(err => {
  console.error('Failed to initialize app:', err);
});
