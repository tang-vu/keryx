/**
 * Hardhat configuration for Keryx contracts.
 * Networks: hardhat (local testing), arcTestnet (Arc testnet chain 5042002).
 * Uses @nomicfoundation/hardhat-viem for viem-compatible artifact generation.
 *
 * Deploy command (human-run after funding deployer wallet from Circle faucet):
 *   npx hardhat run scripts/deploy-source-registry.ts --network arcTestnet
 *
 * Testing: npx hardhat --tsconfig tsconfig.hardhat.json test
 *   Uses tsconfig.hardhat.json (module:commonjs, moduleResolution:node) because the
 *   project's main tsconfig.json uses module:esnext + moduleResolution:bundler (Next.js),
 *   which prevents ts-node from resolving hardhat's named exports (e.g. `ethers`).
 *   The --tsconfig flag sets TS_NODE_PROJECT before ts-node initialises.
 */

import { readFileSync } from "fs";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-viem";

// Hardhat does not auto-load .env.local (only Next.js does), so the one-time deploy would
// otherwise see no DEPLOYER_PRIVATE_KEY. Load it here so the key can live in .env.local
// alongside every other secret. Shell-provided env vars take precedence.
function loadEnvLocal(): void {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env.local — fall back to shell-provided env vars */
  }
}
loadEnvLocal();

// The deployer has no special on-chain role (the registry has no owner/admin), so the
// one-time deploy can reuse the existing funder key when no dedicated deployer key is set.
const deployerKey =
  process.env.DEPLOYER_PRIVATE_KEY ??
  process.env.AGENT_FUNDER_PRIVATE_KEY ??
  process.env.BUYER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      // paris evmVersion: compatible with Arc testnet EVM (pre-Shanghai/Cancun opcodes);
      // avoids PUSH0 (introduced in Shanghai) which may not be supported on all Arc nodes.
      evmVersion: "paris",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      // Local in-process network for compile/test only — no external RPC needed.
    },
    arcTestnet: {
      url: "https://rpc.testnet.arc.network",
      chainId: 5042002,
      // Deployer key is only needed for the one-time contract deploy, not for per-source writes.
      // Per-source registry writes (register/update/deactivate) are creator-signed from the browser.
      accounts: deployerKey ? [deployerKey] : [],
    },
  },
  // Contract source verification on ArcScan (Blockscout). A verified SourceRegistry shows readable
  // source so anyone can confirm the on-chain catalog logic (creator-scoped IDs, basis-point splits).
  // Blockscout exposes an Etherscan-compatible API at /api and ignores the API key (any non-empty
  // string works). Verify with:
  //   npx hardhat verify --network arcTestnet 0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536
  etherscan: {
    apiKey: { arcTestnet: "arcscan-no-key-needed" },
    customChains: [
      {
        network: "arcTestnet",
        chainId: 5042002,
        urls: {
          apiURL: "https://testnet.arcscan.app/api",
          browserURL: "https://testnet.arcscan.app",
        },
      },
    ],
  },
  // Sourcify as a fallback verification route if the Blockscout API path differs.
  sourcify: { enabled: true },
};

export default config;
