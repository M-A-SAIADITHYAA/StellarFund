/**
 * StellarFund — Real-time State Poller
 * Periodically fetches contract state and syncs UI
 */

import { CONFIG } from './config.js';
import { getContractState } from './contract.js';
import { updateCampaignUI } from './ui.js';

let pollInterval = null;
let lastState = null;

/**
 * Start polling for contract state updates
 */
export function startPolling() {
  if (pollInterval) return;
  
  // Initial fetch
  pollNow();

  // Set up interval
  pollInterval = setInterval(pollNow, CONFIG.POLL_INTERVAL_MS);
  console.log('[Poller] Started polling every', CONFIG.POLL_INTERVAL_MS, 'ms');
}

/**
 * Stop polling
 */
export function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('[Poller] Stopped polling');
  }
}

/**
 * Perform a single poll
 */
export async function pollNow() {
  try {
    const state = await getContractState();
    if (!state) return;

    // Check if state has changed
    const stateChanged = !lastState || 
      lastState.raised !== state.raised ||
      lastState.ended !== state.ended ||
      lastState.donorCount !== state.donorCount;

    if (stateChanged) {
      console.log('[Poller] State updated:', {
        raised: state.raised,
        goal: state.goal,
        ended: state.ended,
      });
    }

    lastState = state;
    updateCampaignUI(state);
  } catch (err) {
    console.error('[Poller] Poll failed:', err);
  }
}

/**
 * Get the last known state
 */
export function getLastState() {
  return lastState;
}
