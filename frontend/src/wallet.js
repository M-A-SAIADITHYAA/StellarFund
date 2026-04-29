/**
 * StellarFund — Multi-Wallet Integration
 * Uses StellarWalletsKit for multi-wallet support (Freighter, xBull, Albedo, etc.)
 * Handles 3+ error types: wallet not found, rejected, insufficient balance
 */

import { CONFIG, truncateAddress } from './config.js';
import { showToast } from './ui.js';

// ---- Error Types ----
export class WalletNotFoundError extends Error {
  constructor(msg = 'No Stellar wallet detected. Please install Freighter or xBull wallet extension.') {
    super(msg);
    this.name = 'WalletNotFoundError';
    this.type = 'WALLET_NOT_FOUND';
  }
}

export class TransactionRejectedError extends Error {
  constructor(msg = 'Transaction was rejected by the wallet.') {
    super(msg);
    this.name = 'TransactionRejectedError';
    this.type = 'TX_REJECTED';
  }
}

export class InsufficientBalanceError extends Error {
  constructor(available, required) {
    super(`Insufficient balance. You have ${available} XLM but need ${required} XLM (including fees).`);
    this.name = 'InsufficientBalanceError';
    this.type = 'INSUFFICIENT_BALANCE';
    this.available = available;
    this.required = required;
  }
}

// ---- Wallet State ----
let walletState = {
  connected: false,
  address: null,
  balance: null,
  kitLoaded: false,
};

const listeners = new Set();

export function getWalletState() {
  return { ...walletState };
}

export function onWalletChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners() {
  listeners.forEach(cb => cb(getWalletState()));
}

function updateState(updates) {
  walletState = { ...walletState, ...updates };
  notifyListeners();
}

// ---- Wallet Kit Initialization ----

/**
 * Dynamically loads StellarWalletsKit.
 * Falls back to a simulated wallet if the kit cannot load (for demo purposes).
 */
let StellarWalletsKit = null;

async function loadWalletKit() {
  if (walletState.kitLoaded) return;

  try {
    // Try loading the kit via dynamic import (requires JSR package installed)
    const sdkMod = await import('@creit-tech/stellar-wallets-kit/sdk');
    const utilsMod = await import('@creit-tech/stellar-wallets-kit/modules/utils');
    StellarWalletsKit = sdkMod.StellarWalletsKit;
    StellarWalletsKit.init({ modules: utilsMod.defaultModules() });
    updateState({ kitLoaded: true });
    console.log('[Wallet] StellarWalletsKit loaded successfully');
  } catch (err) {
    console.warn('[Wallet] StellarWalletsKit not available, using Freighter fallback:', err.message);
    updateState({ kitLoaded: true });
  }
}

/**
 * Initialize wallet connection UI.
 * Creates the wallet button in the connect prompt area.
 */
export async function initWallet() {
  await loadWalletKit();

  const buttonWrapper = document.getElementById('wallet-button-wrapper');
  if (!buttonWrapper) return;

  if (StellarWalletsKit) {
    // Use the kit's built-in button (opens multi-wallet modal)
    try {
      StellarWalletsKit.createButton(buttonWrapper);
    } catch (e) {
      console.warn('[Wallet] createButton failed, creating manual button:', e);
      createManualConnectButton(buttonWrapper);
    }
  } else {
    createManualConnectButton(buttonWrapper);
  }
}

function createManualConnectButton(wrapper) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary btn-lg';
  btn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M22 10H18a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h4"></path></svg>
    Connect Wallet
  `;
  btn.addEventListener('click', () => connectFreighter());
  wrapper.appendChild(btn);
}

// ---- Connect via Freighter (direct) ----
async function connectFreighter() {
  try {
    if (!window.freighter && !window.freighterApi) {
      throw new WalletNotFoundError();
    }

    const freighter = window.freighterApi || window.freighter;
    const accessObj = await freighter.requestAccess();
    
    if (accessObj.error) {
      throw new TransactionRejectedError('Wallet connection was rejected.');
    }

    const address = accessObj.address || (await freighter.getPublicKey());
    await onWalletConnected(address);
  } catch (err) {
    handleWalletError(err);
  }
}

// ---- Connect via StellarWalletsKit ----
export async function connectWallet() {
  try {
    await loadWalletKit();

    if (StellarWalletsKit) {
      const { address } = await StellarWalletsKit.getAddress();
      if (!address) throw new WalletNotFoundError();
      await onWalletConnected(address);
    } else {
      await connectFreighter();
    }
  } catch (err) {
    handleWalletError(err);
  }
}

async function onWalletConnected(address) {
  updateState({ connected: true, address });
  console.log('[Wallet] Connected:', address);
  showToast('success', 'Wallet Connected', `Connected to ${truncateAddress(address)}`);
  await fetchBalance();
}

// ---- Disconnect ----
export function disconnectWallet() {
  updateState({ connected: false, address: null, balance: null });
  showToast('info', 'Wallet Disconnected', 'Your wallet has been disconnected.');
}

// ---- Fetch Balance ----
export async function fetchBalance() {
  if (!walletState.address) return;

  try {
    const response = await fetch(`${CONFIG.HORIZON_URL}/accounts/${walletState.address}`);
    if (!response.ok) throw new Error('Account not found');
    
    const data = await response.json();
    const nativeBalance = data.balances.find(b => b.asset_type === 'native');
    const balance = nativeBalance ? parseFloat(nativeBalance.balance) : 0;
    
    updateState({ balance });
    return balance;
  } catch (err) {
    console.error('[Wallet] Failed to fetch balance:', err);
    updateState({ balance: 0 });
    return 0;
  }
}

// ---- Sign Transaction ----
export async function signTransaction(txXDR) {
  if (!walletState.connected) {
    throw new WalletNotFoundError('Please connect your wallet first.');
  }

  try {
    if (StellarWalletsKit) {
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(txXDR, {
        networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
        address: walletState.address,
      });
      return signedTxXdr;
    }

    // Freighter fallback
    const freighter = window.freighterApi || window.freighter;
    if (!freighter) throw new WalletNotFoundError();

    const signedTxXdr = await freighter.signTransaction(txXDR, {
      networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
    });
    return signedTxXdr;
  } catch (err) {
    if (err instanceof WalletNotFoundError || err instanceof TransactionRejectedError) {
      throw err;
    }
    // Detect rejection patterns
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('reject') || msg.includes('denied') || msg.includes('cancel') || msg.includes('user')) {
      throw new TransactionRejectedError();
    }
    throw err;
  }
}

// ---- Check Balance Before Donate ----
export async function checkBalance(requiredXLM) {
  const balance = await fetchBalance();
  const required = requiredXLM + 1; // +1 XLM for tx fees and reserves
  if (balance < required) {
    throw new InsufficientBalanceError(balance.toFixed(2), required.toFixed(2));
  }
  return balance;
}

// ---- Error Handler ----
export function handleWalletError(err) {
  console.error('[Wallet] Error:', err);

  if (err instanceof WalletNotFoundError || err?.type === 'WALLET_NOT_FOUND') {
    showToast('error', 'Wallet Not Found', err.message);
  } else if (err instanceof TransactionRejectedError || err?.type === 'TX_REJECTED') {
    showToast('error', 'Transaction Rejected', err.message);
  } else if (err instanceof InsufficientBalanceError || err?.type === 'INSUFFICIENT_BALANCE') {
    showToast('error', 'Insufficient Balance', err.message);
  } else {
    showToast('error', 'Wallet Error', err.message || 'An unexpected error occurred.');
  }
}
