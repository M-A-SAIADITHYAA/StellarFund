/**
 * StellarFund — UI Rendering & State Management
 * Handles all DOM updates, toasts, and transaction log rendering
 */

import { CONFIG, stroopsToXLM, formatXLM, truncateAddress } from './config.js';
import { getWalletState, onWalletChange, disconnectWallet, connectWallet } from './wallet.js';
import { donate } from './contract.js';

// ---- Toast System ----

let toastCounter = 0;

/**
 * Show a toast notification
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {string} title
 * @param {string} message
 */
export function showToast(type, title, message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const id = `toast-${++toastCounter}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };

  const toast = document.createElement('div');
  toast.id = id;
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ'}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  container.appendChild(toast);

  // Auto-remove after 5s
  setTimeout(() => {
    toast.classList.add('toast-removing');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ---- Transaction Log ----

const transactions = [];

/**
 * Add a transaction to the log
 */
export function addTransaction(tx) {
  transactions.unshift(tx); // newest first
  renderTransactionLog();
}

/**
 * Update an existing transaction's status
 */
export function updateTransaction(id, updates) {
  const tx = transactions.find(t => t.id === id);
  if (tx) {
    Object.assign(tx, updates);
    renderTransactionLog();
  }
}

function renderTransactionLog() {
  const log = document.getElementById('tx-log');
  if (!log) return;

  if (transactions.length === 0) {
    log.innerHTML = `
      <div class="tx-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        <p>No transactions yet</p>
        <p class="tx-empty-hint">Donations will appear here in real-time</p>
      </div>`;
    return;
  }

  log.innerHTML = transactions.map(tx => {
    const statusConfig = {
      building: { icon: '🔨', badge: 'badge-pending', label: 'Building', iconClass: 'tx-icon-pending' },
      simulating: { icon: '⚙️', badge: 'badge-pending', label: 'Simulating', iconClass: 'tx-icon-pending' },
      signing: { icon: '🔑', badge: 'badge-pending', label: 'Signing', iconClass: 'tx-icon-pending' },
      pending: { icon: '⏳', badge: 'badge-warning', label: 'Pending', iconClass: 'tx-icon-pending' },
      success: { icon: '✓', badge: 'badge-success', label: 'Confirmed', iconClass: 'tx-icon-success' },
      failed: { icon: '✕', badge: 'badge-destructive', label: 'Failed', iconClass: 'tx-icon-failed' },
    };
    const sc = statusConfig[tx.status] || statusConfig.pending;
    const hashDisplay = tx.hash
      ? `<a href="${CONFIG.EXPLORER_URL}/tx/${tx.hash}" target="_blank" rel="noopener">${truncateAddress(tx.hash, 8, 6)}</a>`
      : '—';
    const spinnerHTML = ['building', 'simulating', 'signing', 'pending'].includes(tx.status)
      ? '<span class="spinner spinner-sm"></span>' : '';

    return `
      <div class="tx-item" id="${tx.id}">
        <div class="tx-icon ${sc.iconClass}">${sc.icon}</div>
        <div class="tx-details">
          <div class="tx-amount">${formatXLM(tx.amount)} XLM</div>
          <div class="tx-hash">${hashDisplay}</div>
          ${tx.error ? `<div class="tx-hash" style="color: hsl(var(--destructive))">${tx.error}</div>` : ''}
        </div>
        <div class="tx-status">
          <span class="badge ${sc.badge}">${spinnerHTML} ${sc.label}</span>
        </div>
      </div>`;
  }).join('');
}

// ---- Campaign UI Updates ----

/**
 * Update all campaign-related UI elements from contract state
 */
export function updateCampaignUI(state) {
  if (!state) return;

  const goalXLM = stroopsToXLM(state.goal);
  const raisedXLM = stroopsToXLM(state.raised);
  const percent = goalXLM > 0 ? Math.min((raisedXLM / goalXLM) * 100, 100) : 0;

  // Progress section
  setTextContent('raised-amount', formatXLM(raisedXLM));
  setTextContent('goal-amount', formatXLM(goalXLM));
  setTextContent('progress-percent', percent.toFixed(1));

  const bar = document.getElementById('progress-bar');
  if (bar) bar.style.width = `${percent}%`;

  // Stats
  setTextContent('stat-raised', `${formatXLM(raisedXLM)} XLM`);
  setTextContent('stat-donors', state.donorCount.toString());

  // Time remaining
  const now = Math.floor(Date.now() / 1000);
  const remaining = state.deadline - now;
  if (remaining > 0) {
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    setTextContent('stat-time', days > 0 ? `${days}d ${hours}h` : `${hours}h`);
  } else {
    setTextContent('stat-time', 'Ended');
  }

  // Campaign details
  const contractLink = document.getElementById('contract-link');
  if (contractLink) {
    contractLink.href = `${CONFIG.EXPLORER_URL}/contract/${CONFIG.CONTRACT_ID}`;
    contractLink.textContent = truncateAddress(CONFIG.CONTRACT_ID, 10, 6);
  }
  const ownerEl = document.getElementById('campaign-owner');
  if (ownerEl && state.owner !== 'Unknown') {
    ownerEl.textContent = truncateAddress(state.owner.toString(), 10, 6);
  }

  // Status badge
  const statusEl = document.getElementById('campaign-status');
  if (statusEl) {
    if (state.ended) {
      statusEl.className = 'badge badge-destructive';
      statusEl.textContent = 'Ended';
    } else if (remaining <= 0) {
      statusEl.className = 'badge badge-warning';
      statusEl.textContent = 'Expired';
    } else {
      statusEl.className = 'badge badge-success';
      statusEl.textContent = 'Active';
    }
  }
}

// ---- Wallet UI ----

/**
 * Set up wallet state listeners and render wallet UI
 */
export function setupWalletUI() {
  onWalletChange(renderWalletUI);
  renderWalletUI(getWalletState());
  setupDonationForm();
}

function renderWalletUI(state) {
  const walletSection = document.getElementById('wallet-section');
  const connectPrompt = document.getElementById('connect-prompt');
  const donationForm = document.getElementById('donation-form');
  const walletInfo = document.getElementById('wallet-info');

  // Navbar wallet display
  if (walletSection) {
    if (state.connected && state.address) {
      walletSection.innerHTML = `
        <div class="wallet-connected">
          <span class="wallet-addr">${truncateAddress(state.address)}</span>
          <button class="wallet-disconnect" id="disconnect-btn" title="Disconnect">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
          </button>
        </div>`;
      document.getElementById('disconnect-btn')?.addEventListener('click', disconnectWallet);
    } else {
      walletSection.innerHTML = `
        <button class="btn btn-primary" id="nav-connect-btn">
          Connect
        </button>`;
      document.getElementById('nav-connect-btn')?.addEventListener('click', connectWallet);
    }
  }

  // Toggle donate form vs connect prompt
  if (state.connected) {
    connectPrompt?.classList.add('hidden');
    donationForm?.classList.remove('hidden');
    walletInfo?.classList.remove('hidden');

    // Update wallet info
    const addrEl = document.getElementById('wallet-address');
    if (addrEl) addrEl.textContent = truncateAddress(state.address, 10, 6);
    const balEl = document.getElementById('wallet-balance');
    if (balEl) balEl.textContent = state.balance !== null ? `${formatXLM(state.balance)} XLM` : '-- XLM';
  } else {
    connectPrompt?.classList.remove('hidden');
    donationForm?.classList.add('hidden');
    walletInfo?.classList.add('hidden');
  }
}

// ---- Donation Form ----

function setupDonationForm() {
  // Preset amount buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const amount = btn.dataset.amount;
      const input = document.getElementById('donate-amount');
      if (input) input.value = amount;
      // Highlight active preset
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Donate button
  const donateBtn = document.getElementById('donate-btn');
  if (donateBtn) {
    donateBtn.addEventListener('click', handleDonate);
  }

  // Clear preset highlight on manual input
  const input = document.getElementById('donate-amount');
  if (input) {
    input.addEventListener('input', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    });
  }
}

async function handleDonate() {
  const input = document.getElementById('donate-amount');
  const donateBtn = document.getElementById('donate-btn');
  if (!input || !donateBtn) return;

  const amount = parseFloat(input.value);
  if (!amount || amount <= 0) {
    showToast('warning', 'Invalid Amount', 'Please enter a valid donation amount.');
    return;
  }

  // Disable button, show loading
  donateBtn.disabled = true;
  const btnContent = donateBtn.querySelector('.btn-content');
  const btnLoading = donateBtn.querySelector('.btn-loading');
  btnContent?.classList.add('hidden');
  btnLoading?.classList.remove('hidden');

  try {
    await donate(amount);
    input.value = '';
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  } finally {
    donateBtn.disabled = false;
    btnContent?.classList.remove('hidden');
    btnLoading?.classList.add('hidden');
  }
}

// ---- Helpers ----

function setTextContent(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * Initialize with demo/default state before contract loads
 */
export function setDefaultUI() {
  updateCampaignUI({
    owner: 'Loading...',
    token: 'XLM',
    goal: CONFIG.DEFAULT_GOAL * 10_000_000, // stroops
    raised: 0,
    deadline: Math.floor(Date.now() / 1000) + CONFIG.DEFAULT_DEADLINE_DAYS * 86400,
    ended: false,
    donorCount: 0,
  });
}
