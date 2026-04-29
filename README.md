# StellarFund — Decentralized Crowdfunding on Stellar

> **Level 2 — Yellow Belt** | Multi-wallet dApp with Soroban smart contract and real-time event integration

A crowdfunding platform built on Stellar's Soroban smart contract platform. Users can connect multiple wallet types, donate testnet XLM, and track campaign progress in real-time.

## Features

### Smart Contract (Soroban / Rust)
- **initialize** — Set campaign parameters (owner, token, goal, deadline)
- **donate** — Contribute XLM to the campaign
- **withdraw** — Owner claims funds when goal is reached
- **refund** — Donors reclaim funds if goal not met after deadline
- **get_state** — Read campaign state (goal, raised, deadline, ended)
- **get_donation** — Query individual donor contributions

### Frontend (Vite + Vanilla JS)
- **Multi-wallet integration** via `@creit-tech/stellar-wallets-kit` (Freighter, xBull, Albedo, etc.)
- **Real-time progress bar** with animated gradient fill
- **Transaction status tracking** — pending → success / fail with live log
- **3+ error types handled:**
  1. Wallet Not Found — no compatible extension detected
  2. Transaction Rejected — user declined in wallet
  3. Insufficient Balance — account XLM < donation amount
- **shadcn-inspired dark UI** — Zinc color palette, glassmorphism, micro-animations
- **Real-time polling** — contract state synced every 5 seconds

## Prerequisites

- [Rust](https://rustup.rs/) with `wasm32-unknown-unknown` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/stellar-cli)
- [Node.js](https://nodejs.org/) 18+
- A Stellar wallet extension (e.g., [Freighter](https://www.freighter.app/))

## Quick Start

### 1. Deploy the Contract
```bash
# Install Rust wasm target
rustup target add wasm32-unknown-unknown

# Deploy to testnet
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

### 2. Update Config
Copy the Contract ID from `contract-id.txt` into `frontend/src/config.js`.

### 3. Run the Frontend
```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Project Structure

```
yellowbelt/
├── contracts/crowdfund/     # Soroban smart contract (Rust)
│   ├── Cargo.toml
│   └── src/lib.rs
├── frontend/                # Vite frontend app
│   ├── src/
│   │   ├── config.js        # Network & contract configuration
│   │   ├── wallet.js        # Multi-wallet integration + error types
│   │   ├── contract.js      # Contract interaction + tx tracking
│   │   ├── poller.js        # Real-time state synchronization
│   │   ├── ui.js            # UI rendering & state management
│   │   ├── main.js          # Entry point
│   │   └── styles/index.css # shadcn dark theme design system
│   ├── index.html
│   └── vite.config.js
├── scripts/
│   └── deploy.sh            # Testnet deployment script
└── README.md
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contract | Rust + Soroban SDK |
| Frontend | Vite + Vanilla JS |
| Wallet | @creit-tech/stellar-wallets-kit |
| Blockchain SDK | @stellar/stellar-sdk |
| Styling | Vanilla CSS (shadcn-inspired) |
| Network | Stellar Testnet |

## License

MIT
