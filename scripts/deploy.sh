#!/bin/bash
# =============================================================
# Stellar Soroban Crowdfund Contract — Deployment Script
# =============================================================
# Prerequisites:
#   - Rust toolchain with wasm32-unknown-unknown target
#   - Stellar CLI (stellar-cli) installed
#
# Usage: ./scripts/deploy.sh
# =============================================================

set -e

echo "============================================"
echo "  Crowdfund Contract Deployment — Testnet"
echo "============================================"

# Configuration
IDENTITY_NAME="crowdfund-deployer"
NETWORK="testnet"
GOAL_XLM=1000          # Campaign goal in XLM
DEADLINE_DAYS=7         # Campaign duration in days

# Navigate to contract directory
cd "$(dirname "$0")/../contracts/crowdfund"

# Step 1: Generate a testnet identity (if not exists)
echo ""
echo "Step 1: Setting up deployer identity..."
if stellar keys address "$IDENTITY_NAME" 2>/dev/null; then
    echo "  Identity '$IDENTITY_NAME' already exists."
else
    echo "  Generating new identity '$IDENTITY_NAME'..."
    stellar keys generate --global "$IDENTITY_NAME" --network "$NETWORK"
    echo "  Identity created."
fi

DEPLOYER_ADDRESS=$(stellar keys address "$IDENTITY_NAME")
echo "  Deployer address: $DEPLOYER_ADDRESS"

# Step 2: Fund the account via Friendbot
echo ""
echo "Step 2: Funding account via Friendbot..."
curl -s "https://friendbot.stellar.org?addr=$DEPLOYER_ADDRESS" > /dev/null 2>&1 || true
echo "  Account funded (or already funded)."

# Step 3: Build the contract
echo ""
echo "Step 3: Building the contract..."
stellar contract build
echo "  Build complete."

WASM_PATH="../../target/wasm32-unknown-unknown/release/crowdfund.wasm"

# Step 4: Deploy to testnet
echo ""
echo "Step 4: Deploying to testnet..."
CONTRACT_ID=$(stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source "$IDENTITY_NAME" \
    --network "$NETWORK")

echo "  Contract deployed!"
echo "  Contract ID: $CONTRACT_ID"

# Save contract ID
echo "$CONTRACT_ID" > ../../contract-id.txt
echo "  Saved to contract-id.txt"

# Step 5: Get the native XLM SAC (Stellar Asset Contract) address
echo ""
echo "Step 5: Getting native XLM token address..."
# The native XLM SAC on testnet
XLM_SAC="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"

# Step 6: Initialize the campaign
echo ""
echo "Step 6: Initializing the campaign..."

# Calculate deadline (current unix timestamp + days in seconds)
DEADLINE=$(( $(date +%s) + DEADLINE_DAYS * 86400 ))

# Goal in stroops (1 XLM = 10_000_000 stroops)
GOAL_STROOPS=$(( GOAL_XLM * 10000000 ))

stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY_NAME" \
    --network "$NETWORK" \
    -- \
    initialize \
    --owner "$DEPLOYER_ADDRESS" \
    --token "$XLM_SAC" \
    --goal "$GOAL_STROOPS" \
    --deadline "$DEADLINE"

echo "  Campaign initialized!"
echo ""
echo "============================================"
echo "  Deployment Summary"
echo "============================================"
echo "  Contract ID:  $CONTRACT_ID"
echo "  Owner:        $DEPLOYER_ADDRESS"
echo "  Goal:         $GOAL_XLM XLM"
echo "  Deadline:     $(date -r $DEADLINE 2>/dev/null || date -d @$DEADLINE 2>/dev/null || echo $DEADLINE)"
echo "  Token (XLM):  $XLM_SAC"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Copy the Contract ID to src/config.js"
echo "  2. Run 'npm run dev' to start the frontend"
echo ""
