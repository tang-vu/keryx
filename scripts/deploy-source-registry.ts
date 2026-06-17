/**
 * Hardhat deploy script for SourceRegistry.
 *
 * Run (human-executed, requires funded deployer wallet):
 *   npx hardhat run scripts/deploy-source-registry.ts --network arcTestnet
 *
 * After running, copy the printed address and block number into .env.local:
 *   KERYX_REGISTRY_ADDRESS=0x...
 *   NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS=0x...
 *   KERYX_REGISTRY_DEPLOY_BLOCK=<blockNumber>
 *
 * The deployer key is used ONLY for this one-time deploy.
 * Per-source writes (register/update/deactivate) are creator-signed from the browser.
 */

// hardhat is a CommonJS module; default-import then destructure so this runs whether the
// script is loaded as CJS or as a native ES module (Node strips TS types and treats it as ESM).
import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying SourceRegistry from:", deployer.address);

  const SourceRegistry = await ethers.getContractFactory("SourceRegistry");
  const registry = await SourceRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const deployTx = registry.deploymentTransaction();

  if (!deployTx) {
    throw new Error("Deployment transaction not found");
  }

  const receipt = await deployTx.wait();
  const blockNumber = receipt?.blockNumber ?? 0;

  console.log("\n=== SourceRegistry deployed ===");
  console.log("Address:      ", address);
  console.log("Deploy block: ", blockNumber);
  console.log("\nAdd to .env.local:");
  console.log(`KERYX_REGISTRY_ADDRESS=${address}`);
  console.log(`NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS=${address}`);
  console.log(`KERYX_REGISTRY_DEPLOY_BLOCK=${blockNumber}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
