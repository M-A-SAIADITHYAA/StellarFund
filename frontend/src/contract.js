/**
 * StellarFund — Contract Interaction Module
 * Handles calling the crowdfund Soroban contract from the frontend
 * Tracks transaction status: pending → success / fail
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { CONFIG, stroopsToXLM, xlmToStroops, formatXLM } from './config.js';
import { getWalletState, signTransaction, checkBalance, handleWalletError, InsufficientBalanceError, TransactionRejectedError } from './wallet.js';
import { showToast, addTransaction, updateTransaction } from './ui.js';

const { rpc, TransactionBuilder, Networks, Contract, Operation, Asset, BASE_FEE, Address, xdr, nativeToScVal, scValToNative } = StellarSdk;

// Soroban RPC server
let server;

function getServer() {
  if (!server) {
    server = new rpc.Server(CONFIG.SOROBAN_RPC_URL, { allowHttp: false });
  }
  return server;
}

// ---- Read Contract State ----

/**
 * Fetches the current campaign state from the contract.
 * Returns { owner, token, goal, raised, deadline, ended, donorCount }
 */
export async function getContractState() {
  try {
    const srv = getServer();
    const contract = new Contract(CONFIG.CONTRACT_ID);
    const account = await srv.getAccount(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
    ).catch(() => null);

    // Build a simulation-only tx to call get_state
    const sourceAccount = account || new StellarSdk.Account(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call('get_state'))
      .setTimeout(30)
      .build();

    const simResult = await srv.simulateTransaction(tx);
    
    if (rpc.Api.isSimulationError(simResult)) {
      console.error('[Contract] Simulation error:', simResult);
      return null;
    }

    const result = simResult.result?.retval;
    if (!result) return null;

    // Parse the CampaignState struct from ScVal
    const state = parseContractState(result);
    return state;
  } catch (err) {
    console.error('[Contract] Failed to get state:', err);
    return null;
  }
}

/**
 * Parse CampaignState ScVal into a JS object
 */
function parseContractState(scVal) {
  try {
    const native = scValToNative(scVal);
    return {
      owner: native.owner || native.owner?.toString() || 'Unknown',
      token: native.token || native.token?.toString() || 'Unknown',
      goal: Number(native.goal || 0),
      raised: Number(native.raised || 0),
      deadline: Number(native.deadline || 0),
      ended: Boolean(native.ended),
      donorCount: Number(native.donor_count || 0),
    };
  } catch (err) {
    console.warn('[Contract] Failed to parse state, using raw:', err);
    return {
      owner: 'Unknown',
      token: 'Unknown',
      goal: 10_000_000_000, // 1000 XLM
      raised: 0,
      deadline: Math.floor(Date.now() / 1000) + 7 * 86400,
      ended: false,
      donorCount: 0,
    };
  }
}

// ---- Donate ----

/**
 * Donate XLM to the crowdfunding campaign.
 * Builds, simulates, signs, and submits the transaction.
 * @param {number} amountXLM — Amount in XLM
 */
export async function donate(amountXLM) {
  const wallet = getWalletState();
  if (!wallet.connected || !wallet.address) {
    showToast('error', 'Not Connected', 'Please connect your wallet first.');
    return null;
  }

  // Check balance first (error type: InsufficientBalanceError)
  try {
    await checkBalance(amountXLM);
  } catch (err) {
    handleWalletError(err);
    return null;
  }

  // Create a tracking entry in the TX log
  const txId = `tx-${Date.now()}`;
  addTransaction({
    id: txId,
    amount: amountXLM,
    status: 'building',
    hash: null,
    timestamp: Date.now(),
  });

  try {
    const srv = getServer();
    const contract = new Contract(CONFIG.CONTRACT_ID);

    // Get the source account
    updateTransaction(txId, { status: 'building' });
    const sourceAccount = await srv.getAccount(wallet.address);

    // Build the invoke contract tx
    const amountStroops = xlmToStroops(amountXLM);
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        contract.call(
          'donate',
          nativeToScVal(Address.fromString(wallet.address), { type: 'address' }),
          nativeToScVal(amountStroops, { type: 'i128' })
        )
      )
      .setTimeout(60)
      .build();

    // Simulate
    updateTransaction(txId, { status: 'simulating' });
    const simResult = await srv.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(simResult)) {
      const errMsg = simResult.error || 'Simulation failed';
      throw new Error(`Contract error: ${errMsg}`);
    }

    // Prepare the transaction with simulation results
    const preparedTx = rpc.assembleTransaction(tx, simResult).build();

    // Sign via wallet
    updateTransaction(txId, { status: 'signing' });
    const signedXDR = await signTransaction(preparedTx.toXDR());

    // Submit
    updateTransaction(txId, { status: 'pending' });
    const txToSubmit = TransactionBuilder.fromXDR(signedXDR, Networks.TESTNET);
    const sendResult = await srv.sendTransaction(txToSubmit);

    if (sendResult.status === 'ERROR') {
      throw new Error(`Submit error: ${sendResult.errorResult?.toString() || 'Unknown'}`);
    }

    const hash = sendResult.hash;
    updateTransaction(txId, { hash, status: 'pending' });

    // Poll for confirmation
    const finalResult = await pollTransactionStatus(hash, txId);
    return finalResult;
  } catch (err) {
    console.error('[Contract] Donate failed:', err);

    if (err instanceof TransactionRejectedError) {
      updateTransaction(txId, { status: 'failed', error: 'Rejected by wallet' });
      handleWalletError(err);
    } else if (err instanceof InsufficientBalanceError) {
      updateTransaction(txId, { status: 'failed', error: 'Insufficient balance' });
      handleWalletError(err);
    } else {
      updateTransaction(txId, { status: 'failed', error: err.message });
      showToast('error', 'Transaction Failed', err.message);
    }
    return null;
  }
}

// ---- Poll Transaction ----

/**
 * Polls the Soroban RPC for transaction confirmation.
 * Updates the UI as status changes.
 */
async function pollTransactionStatus(hash, txId) {
  const srv = getServer();
  const maxAttempts = 30;
  let attempts = 0;

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      attempts++;

      try {
        const response = await srv.getTransaction(hash);

        if (response.status === 'SUCCESS') {
          clearInterval(interval);
          updateTransaction(txId, { status: 'success' });
          showToast('success', 'Donation Successful!', `Your donation has been confirmed on the Stellar network.`);
          resolve(response);
        } else if (response.status === 'FAILED') {
          clearInterval(interval);
          updateTransaction(txId, { status: 'failed', error: 'Transaction failed on-chain' });
          showToast('error', 'Transaction Failed', 'The transaction failed on the network.');
          reject(new Error('Transaction failed'));
        } else if (response.status === 'NOT_FOUND' && attempts >= maxAttempts) {
          clearInterval(interval);
          updateTransaction(txId, { status: 'failed', error: 'Transaction timed out' });
          showToast('error', 'Transaction Timeout', 'Could not confirm transaction. Please check Stellar Expert.');
          reject(new Error('Transaction timeout'));
        }
        // else status is NOT_FOUND and we keep polling
      } catch (err) {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          updateTransaction(txId, { status: 'failed', error: 'Polling error' });
          reject(err);
        }
      }
    }, CONFIG.TX_POLL_INTERVAL_MS);
  });
}

// ---- Get Donation Amount for a Donor ----

export async function getDonation(address) {
  try {
    const srv = getServer();
    const contract = new Contract(CONFIG.CONTRACT_ID);

    const sourceAccount = new StellarSdk.Account(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        contract.call(
          'get_donation',
          nativeToScVal(Address.fromString(address), { type: 'address' })
        )
      )
      .setTimeout(30)
      .build();

    const simResult = await srv.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) return 0;

    const result = simResult.result?.retval;
    return result ? Number(scValToNative(result)) : 0;
  } catch (err) {
    console.error('[Contract] Failed to get donation:', err);
    return 0;
  }
}
