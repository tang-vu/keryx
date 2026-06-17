/**
 * Hardhat configuration for Keryx contracts.
 * Networks: hardhat (local testing), arcTestnet (Arc testnet chain 5042002).
 * Uses @nomicfoundation/hardhat-viem for viem-compatible artifact generation.
 *
 * Deploy command (human-run after funding deployer wallet from Circle faucet):
 *   npx hardhat run scripts/deploy-source-registry.ts --network arcTestnet
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

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;

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
};

export default config;
