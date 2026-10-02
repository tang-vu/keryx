import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { ARC_MAINNET_PROFILE as network } from "../lib/arc-network-profile";
import { canonicalJson } from "../lib/canonical-json";

const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(value => !/^0x0{40}$/.test(value));
const registryAbi = parseAbi(["function register(bytes32 urlHash,address payoutWallet,(address wallet,uint16 basisPoints)[] authors,uint64 fetchPriceUsdc6,string contentCid,string tags)"]);
const tokenAbi = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);
const gatewayAbi = parseAbi(["function depositFor(address token,address depositor,uint256 value)"]);
const sourceSchema = z.object({ kind: z.literal("register"), creator: address,
  canonicalUrl: z.string().min(1).max(2048).refine(value => { try { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password; } catch { return false; } }),
  payoutWallet: address, authors: z.array(z.object({ wallet: address, basisPoints: z.number().int().positive().max(10_000) }).strict()).min(1).max(20),
  fetchPriceMicros: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/).refine(value => BigInt(value) <= BigInt("18446744073709551615")),
  contentCid: z.string().refine(value => Buffer.byteLength(value) <= 128),
  tags: z.string().refine(value => Buffer.byteLength(value) <= 256),
}).strict();
const fundingSchema = z.object({ kind: z.literal("fund"), owner: address, sessionSigner: address,
  amountMicros: z.string().regex(/^[1-9][0-9]{0,76}$/).refine(value => BigInt(value) < BigInt(2) ** BigInt(256)) }).strict();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const tx = (from: string, to: string | null, data: Hex) => ({ chainId: network.chainId, from, to, data, valueNativeAtomic: "0" });
const notice = { unsignedOnly: true, broadcast: false, publicMainnetDirectionAuthorized: true, transactionFundingAuthorized: false,
  gas: { nativeDecimals: 18, estimate: null, includedInResearchCap: false,
    requirement: "Owner must separately review native USDC setup gas, nonce, fees, allowance, balances and chain authority before signing." } } as const;

/** Emission must describe this exact clean reviewed release, including nonignored new source. */
export function assertReviewedRelease(releaseCommit: string, repo = fileURLToPath(new URL("../", import.meta.url))) {
  const git = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, maxBuffer: 262_144 });
  if (git(["rev-parse", "HEAD"]).trim() !== releaseCommit || git(["status", "--porcelain", "--untracked-files=all"]).trim())
    throw new Error("setup refused");
}

/** Ordinary public mainnet operations; no enrolled buyer/source lists or pilot ceilings. */
export function prepareUnsignedMainnetOperation(releaseCommit: string, registryAddress: string, operationInput: unknown) {
  z.string().regex(/^[0-9a-f]{40}$/).parse(releaseCommit); address.parse(registryAddress);
  const common = { format: "keryx-mainnet-unsigned-setup-v2", networkId: network.networkId, releaseCommit, ...notice };
  if (typeof operationInput === "object" && operationInput !== null && "kind" in operationInput && operationInput.kind === "register") {
    const source = sourceSchema.parse(operationInput);
    const urlHash = keccak256(toBytes(source.canonicalUrl));
    const sourceId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [source.creator as Address, urlHash]));
    if (source.authors.reduce((sum, author) => sum + author.basisPoints, 0) !== 10_000 ||
      new Set(source.authors.map(author => author.wallet)).size !== source.authors.length) throw new Error("setup refused");
    return { ...common, operation: source.kind, sourceId, urlHash, publicSource: source,
      sourceAuthority: "Creator must sign; URL/feed rights and fresh mainnet registry receipt must be verified before catalog import. Public fields are declarations, not ownership evidence.",
      transactions: [tx(source.creator, registryAddress, encodeFunctionData({ abi: registryAbi, functionName: "register",
        args: [urlHash, source.payoutWallet as Address, source.authors.map(a => ({ wallet: a.wallet as Address, basisPoints: a.basisPoints })), BigInt(source.fetchPriceMicros), source.contentCid, source.tags] }))] };
  }
  const funding = fundingSchema.parse(operationInput);
  if (funding.owner === funding.sessionSigner) throw new Error("setup refused");
  return { ...common, operation: funding.kind, owner: funding.owner, sessionSigner: funding.sessionSigner,
    amountMicros: funding.amountMicros, erc20Decimals: 6,
    signerEvidence: "Public address declaration only. Owner must compare the fresh network/origin/owner-scoped worker signer and separately authorize this exact funding amount.",
    transactions: [tx(funding.owner, network.usdcAddress, encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [network.gatewayWallet, BigInt(funding.amountMicros)] })),
      tx(funding.owner, network.gatewayWallet, encodeFunctionData({ abi: gatewayAbi, functionName: "depositFor", args: [network.usdcAddress, funding.sessionSigner as Address, BigInt(funding.amountMicros)] }))] };
}

/** Bounded explicit local JSON reads, including refusal before opening a FIFO/device/symlink. */
async function readBoundedRegularBytes(path: string, maxBytes: number): Promise<Buffer> {
  const selected = await lstat(path);
  if (!selected.isFile() || selected.size < 2 || selected.size > maxBytes) throw new Error("setup refused");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== selected.size || before.ino !== selected.ino || before.dev !== selected.dev ||
      before.mtimeMs !== selected.mtimeMs || before.ctimeMs !== selected.ctimeMs) throw new Error("setup refused");
    const bytes = Buffer.alloc(maxBytes + 1), read = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
    if (read.bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("setup refused");
    return bytes.subarray(0, read.bytesRead);
  } finally { await handle.close(); }
}

export async function readUnsignedSetupJson(path: string, maxBytes = 16_384): Promise<unknown> {
  return JSON.parse((await readBoundedRegularBytes(path, maxBytes)).toString("utf8"));
}

type RegistryArtifact = { compiler: string; sourceSha256Lf: string; compilerInput: { sources: Record<string, { content: string }>; settings: unknown };
  bytecode: Hex; deployedBytecode: Hex; abi: unknown };

/** Curated release data, not any local build output. Pin changes require source/bytecode review. */
export function validateRegistryArtifact(input: unknown, currentSource: string): RegistryArtifact {
  const artifact = input as RegistryArtifact;
  const normalizedSource = currentSource.replace(/\r\n/g, "\n");
  if (sha256(canonicalJson(input)) !== "3333207861dfa43c8dde7e181bb6a5e8eaca5b3b38155020a322f431448ef16e" || artifact.compiler !== "0.8.24+commit.e11b9ed9" ||
    artifact.sourceSha256Lf !== sha256(normalizedSource) ||
    artifact.compilerInput.sources["contracts/source-registry.sol"].content !== normalizedSource ||
    Object.keys(artifact.compilerInput.sources).length !== 1 ||
    canonicalJson(artifact.compilerInput.settings) !== canonicalJson({ evmVersion: "paris", optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } } })) throw new Error("setup refused");
  return artifact;
}

/** Same bounded fixed source/fixture reader for deployment and offline compiler review. */
export async function loadReviewedRegistryArtifact() {
  return validateRegistryArtifact(
    await readUnsignedSetupJson(fileURLToPath(new URL("./fixtures/mainnet-source-registry.json", import.meta.url)), 65_536),
    (await readBoundedRegularBytes(fileURLToPath(new URL("../contracts/source-registry.sol", import.meta.url)), 16_384)).toString("utf8"));
}

/** Fixed locally compiled v1 contract: no constructor, proxy, admin, external link or funds. */
export async function prepareUnsignedRegistryDeployment(deployer: string, releaseCommit: string) {
  address.parse(deployer); z.string().regex(/^[0-9a-f]{40}$/).parse(releaseCommit);
  const artifact = await loadReviewedRegistryArtifact();
  return { format: "keryx-mainnet-unsigned-setup-v2", operation: "deploy", networkId: network.networkId, releaseCommit,
    ...notice, provenance: { contract: "SourceRegistry", sourceName: "contracts/source-registry.sol", compiler: artifact.compiler,
      sourceSha256Lf: artifact.sourceSha256Lf, compilerInputSha256: sha256(canonicalJson(artifact.compilerInput)),
      creationBytecodeKeccak256: keccak256(artifact.bytecode), runtimeBytecodeKeccak256: keccak256(artifact.deployedBytecode),
      compilerSettings: { evmVersion: "paris", optimizer: { enabled: true, runs: 200 } } },
    deployedBytecode: artifact.deployedBytecode, abi: artifact.abi, transactions: [tx(deployer, null, artifact.bytecode)] };
}

async function unsignedSetupMain() {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && args[0] === "--help")) {
    console.log("Offline unsigned mainnet setup; never signs or broadcasts.\nUsage:\n  npm run mainnet:unsigned-setup -- deploy <public-deployer-address> <full-release-commit>\n  npm run mainnet:unsigned-setup -- workspace <public-deployer-address> <full-release-commit> <fresh-absolute-output-directory>\n  npm run mainnet:unsigned-setup -- verify-compiled <public-compiler-output-json> <full-release-commit>\n  npm run mainnet:unsigned-setup -- prepare <public-operation-json> <fresh-registry-address> <full-release-commit>\nPublic operation fields only. ERC20 amounts are integer micro-USDC; native setup gas, fees, nonce, fresh chain/source/custody evidence and funds authorization are separate.");
  } else {
    try {
      let result;
      if (args[0] === "deploy" && args.length === 3) {
        assertReviewedRelease(args[2]); result = await prepareUnsignedRegistryDeployment(args[1], args[2]);
      } else if (args[0] === "prepare" && args.length === 4) {
        assertReviewedRelease(args[3]); result = prepareUnsignedMainnetOperation(args[3], args[2], await readUnsignedSetupJson(args[1]));
      } else if (args[0] === "workspace" && args.length === 4) {
        assertReviewedRelease(args[2]);
        const { registryWorkspaceFiles, writeRegistryWorkspace } = await import("./helpers/mainnet-registry-workspace.mjs");
        result = await writeRegistryWorkspace(args[3], await registryWorkspaceFiles(args[1], args[2]));
      } else if (args[0] === "verify-compiled" && args.length === 3) {
        assertReviewedRelease(args[2]);
        const { verifyCompiledRegistry } = await import("./helpers/mainnet-registry-workspace.mjs");
        result = await verifyCompiledRegistry(await readUnsignedSetupJson(args[1], 262_144));
      }
      if (!result) throw new Error("setup refused");
      console.log(JSON.stringify(result, null, 2));
    } catch { console.error("Unsigned setup unavailable or refused; no private detail retained."); process.exitCode = 2; }
  }
}

// Complete module evaluation before the workspace helper imports these pure exports.
// The CLI owns errors internally; no top-level await cycle or library-side execution.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void unsignedSetupMain();
