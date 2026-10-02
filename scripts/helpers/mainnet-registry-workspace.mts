import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import { keccak256, toBytes } from "viem";
import { canonicalJson } from "../../lib/canonical-json";
import { prepareUnsignedRegistryDeployment, loadReviewedRegistryArtifact } from "../mainnet-unsigned-setup.mjs";
import { readFile } from "node:fs/promises";

const refused = () => { throw new Error("Registry workspace refused"); };
const objectCode = z.object({ object: z.string().regex(/^(?:0x)?[0-9a-fA-F]+$/) }).passthrough();
const compiledContract = z.object({ abi: z.array(z.unknown()), metadata: z.string().max(65536),
  evm: z.object({ bytecode: objectCode, deployedBytecode: objectCode }).passthrough() }).passthrough();

async function reviewedArtifact() {
  return loadReviewedRegistryArtifact();
}

/** Verify standard solc output or Remix's exported contract artifact, offline. */
export async function verifyCompiledRegistry(input: unknown) {
  const expected = await reviewedArtifact();
  const container = z.record(z.string(), z.unknown()).parse(input);
  const selected = container.contracts
    ? z.object({ contracts: z.object({ "contracts/source-registry.sol": z.object({ SourceRegistry: compiledContract }) }) }).parse(input).contracts["contracts/source-registry.sol"].SourceRegistry
    : compiledContract.parse({ ...container, evm: { bytecode: container.bytecode, deployedBytecode: container.deployedBytecode } });
  const metadata = z.object({ compiler: z.object({ version: z.literal("0.8.24+commit.e11b9ed9") }),
    settings: z.object({ evmVersion: z.literal("paris"), optimizer: z.object({ enabled: z.literal(true), runs: z.literal(200) }),
      compilationTarget: z.object({ "contracts/source-registry.sol": z.literal("SourceRegistry") }).strict() }),
    sources: z.object({ "contracts/source-registry.sol": z.object({ keccak256: z.string() }) }).strict() }).parse(JSON.parse(selected.metadata));
  const hex = (value: string) => `0x${value.replace(/^0x/, "").toLowerCase()}`;
  if (hex(selected.evm.bytecode.object) !== expected.bytecode || hex(selected.evm.deployedBytecode.object) !== expected.deployedBytecode
    || canonicalJson(selected.abi) !== canonicalJson(expected.abi)
    || metadata.sources["contracts/source-registry.sol"].keccak256 !== keccak256(toBytes(expected.compilerInput.sources["contracts/source-registry.sol"].content))) refused();
  return { compiledSourceVerified: true, compiler: expected.compiler,
    creationBytecodeKeccak256: keccak256(expected.bytecode), runtimeBytecodeKeccak256: keccak256(expected.deployedBytecode),
    unsignedOnly: true, broadcast: false };
}

export async function registryWorkspaceFiles(deployer: string, releaseCommit: string) {
  const deployment = await prepareUnsignedRegistryDeployment(deployer, releaseCommit), artifact = await reviewedArtifact();
  const readme = `# Owner-reviewed Arc SourceRegistry deployment\n\nRelease: ${releaseCommit}\nOwner wallet: ${deployer}\nChain: 5042 (0x13b2). Transaction value: 0. Native RPC gas/balance values use 18 decimals; ERC20 values use 6 decimals for the SAME user-facing USDC balance. Deployment gas budget is distinct from the research operating budget.\n\nUse the exact frozen source checkout: git clone https://github.com/tang-vu/keryx.git, then git checkout ${releaseCommit}. Install the repository pinned toolchain/dependencies there before running the verifier command. The generated public workspace does not contain an executable verifier.\n\nOpen https://remix.ethereum.org and import this public folder. Keep the exact contracts/source-registry.sol path. Select Solidity0.8.24+commit.e11b9ed9, optimizer enabled200runs and Paris EVM. Compile SourceRegistry. Export Compilation Details / standard compiler output and run:\n\nnpm run mainnet:unsigned-setup -- verify-compiled <compiler-output.json> ${releaseCommit}\n\nThe verifier must accept BOTH exact creation/runtime bytecode and ABI before deployment. compiler-input.json is the complete reviewed standard compiler input, not an instruction to change the release source.\n\nWith your existing OKX Wallet extension, choose Browser Extension in Remix Deploy & Run. With OKX mobile, use WalletConnect; approve connection in your own wallet. Preserve hardware-wallet confirmation where applicable. Confirm Arc mainnet was added with chain 5042, USDC, the official RPC and https://explorer.arc.io. Verify wallet account ${deployer}, chain5042 and transaction value0. Review the wallet's actual gas/fee/nonce and deployment data against registry-review.json. Never enter/export a private key, recovery phrase or hardware-wallet secret into Remix, Keryx, this workspace or chat.\n\nSTOP before approving the wallet transaction until the exact native gas funding/maximum cost is reviewed with the owner. Public mainnet direction is approved; no concrete setup spending transaction has yet been approved or performed by this tool.\n\nAfter the owner approves in their wallet, preserve transaction hash and final receipt. Independently attest RPC chain5042 and exact deployed runtime bytecode at the resulting address before configuration/catalog import. Existing keryx.cc/register handles ordinary creator registration after that reviewed release selects the fresh registry. No testnet payout cache or ledger is authority.\n\nOfficial connected-wallet workflow: https://remix-ide.readthedocs.io/en/latest/run.html\n`;
  return { "contracts/source-registry.sol": artifact.compilerInput.sources["contracts/source-registry.sol"].content,
    "compiler-input.json": JSON.stringify(artifact.compilerInput, null, 2) + "\n",
    "registry-review.json": JSON.stringify(deployment, null, 2) + "\n", "README.md": readme };
}

/** Fresh explicit public output folder; no overwrite or symlink/junction parents. */
export async function writeRegistryWorkspace(directory: string, files: Awaited<ReturnType<typeof registryWorkspaceFiles>>) {
  const snapshot = z.object({ "contracts/source-registry.sol": z.string().max(16384), "compiler-input.json": z.string().max(65536),
    "registry-review.json": z.string().max(65536), "README.md": z.string().max(16384) }).strict().parse(files);
  if (!isAbsolute(directory)) refused();
  directory = resolve(directory);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(basename(directory))) refused();
  const parent = dirname(directory);
  if (resolve(await realpath(parent)) !== parent) refused();
  await mkdir(directory); const identity = await lstat(directory);
  await mkdir(join(directory, "contracts"));
  for (const [name, contents] of Object.entries(snapshot)) {
    const target = join(directory, name);
    if (!target.startsWith(directory + sep) || resolve(await realpath(dirname(target))) !== dirname(target)) refused();
    const current = await lstat(directory);
    if (!current.isDirectory() || current.isSymbolicLink() || current.ino !== identity.ino || current.dev !== identity.dev) refused();
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o644);
    try { await handle.writeFile(contents, "utf8"); await handle.sync(); } finally { await handle.close(); }
    if (await readFile(target, "utf8") !== contents) refused();
  }
  return { publicWorkspaceCreated: true, fileCount: Object.keys(files).length, unsignedOnly: true, broadcast: false };
}
