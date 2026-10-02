import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { ARC_MAINNET_PROFILE as network } from "../lib/arc-network-profile";
import { canonicalJson } from "../lib/canonical-json";
import { parsePublicMainnetEnrollment, publicMainnetEnrollmentDigest } from "../lib/mainnet-pilot/public-enrollment";

const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(value => !/^0x0{40}$/.test(value));
const registryAbi = parseAbi(["function register(bytes32 urlHash,address payoutWallet,(address wallet,uint16 basisPoints)[] authors,uint64 fetchPriceUsdc6,string contentCid,string tags)"]);
const tokenAbi = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);
const gatewayAbi = parseAbi(["function depositFor(address token,address depositor,uint256 value)"]);
const sourceSchema = z.object({ kind: z.literal("register"), creator: address,
  canonicalUrl: z.string().min(1).max(2048).refine(value => { try { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password; } catch { return false; } }),
  payoutWallet: address, authors: z.array(z.object({ wallet: address, basisPoints: z.number().int().positive().max(10_000) }).strict()).min(1).max(5),
  fetchPriceMicros: z.number().int().positive().max(10_000),
  contentCid: z.string().refine(value => Buffer.byteLength(value) <= 128),
  tags: z.string().refine(value => Buffer.byteLength(value) <= 256),
}).strict();
const fundingSchema = z.object({ kind: z.literal("fund"), owner: address, sessionSigner: address,
  amountMicros: z.number().int().positive().max(250_000) }).strict();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const tx = (from: string, to: string | null, data: Hex) => ({ chainId: network.chainId, from, to, data, valueNativeAtomic: "0" });
const notice = { unsignedOnly: true, broadcast: false, launchAuthorized: false,
  gas: { nativeDecimals: 18, estimate: null, includedInResearchCap: false,
    requirement: "Owner must separately review native USDC setup gas, nonce, fees, allowance, balances and chain authority before signing." } } as const;

/** Emission must describe this exact clean reviewed release, including nonignored new source. */
export function assertReviewedRelease(releaseCommit: string, repo = fileURLToPath(new URL("../", import.meta.url))) {
  const git = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, maxBuffer: 262_144 });
  if (git(["rev-parse", "HEAD"]).trim() !== releaseCommit || git(["status", "--porcelain", "--untracked-files=all"]).trim())
    throw new Error("setup refused");
}

/** Public declarations only; a returned request never proves an owner signature or funded state. */
export async function prepareUnsignedPilotSetup(enrollmentInput: unknown, operationInput: unknown) {
  const enrollment = parsePublicMainnetEnrollment(enrollmentInput);
  const enrollmentDigest = await publicMainnetEnrollmentDigest(enrollment);
  const common = { format: "keryx-mainnet-unsigned-setup-v1", networkId: network.networkId,
    releaseCommit: enrollment.releaseCommit, enrollmentDigest, ...notice };
  if (typeof operationInput === "object" && operationInput !== null && "kind" in operationInput && operationInput.kind === "register") {
    const source = sourceSchema.parse(operationInput);
    const urlHash = keccak256(toBytes(source.canonicalUrl));
    const sourceId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [source.creator as Address, urlHash]));
    if (!enrollment.approvedSourceIds.includes(sourceId) || !enrollment.approvedCreatorAddresses.includes(source.creator) ||
      !enrollment.approvedPayoutAddresses.includes(source.payoutWallet) ||
      source.authors.some(author => !enrollment.approvedPayoutAddresses.includes(author.wallet)) ||
      source.authors.reduce((sum, author) => sum + author.basisPoints, 0) !== 10_000 ||
      new Set(source.authors.map(author => author.wallet)).size !== source.authors.length ||
      source.fetchPriceMicros > enrollment.limits.perPaymentMicros) throw new Error("setup refused");
    return { ...common, operation: source.kind, sourceId, urlHash, publicSource: source,
      transactions: [tx(source.creator, enrollment.registryAddress, encodeFunctionData({ abi: registryAbi, functionName: "register",
        args: [urlHash, source.payoutWallet as Address, source.authors.map(a => ({ wallet: a.wallet as Address, basisPoints: a.basisPoints })), BigInt(source.fetchPriceMicros), source.contentCid, source.tags] }))] };
  }
  const funding = fundingSchema.parse(operationInput);
  if (!enrollment.invitedBuyers.includes(funding.owner) || funding.owner === funding.sessionSigner ||
    enrollment.retainedTestnetSigners.includes(funding.sessionSigner) || funding.amountMicros > enrollment.limits.perBuyerMicros)
    throw new Error("setup refused");
  return { ...common, operation: funding.kind, owner: funding.owner, sessionSigner: funding.sessionSigner,
    amountMicros: funding.amountMicros, erc20Decimals: 6,
    signerEvidence: "Public address declaration only; operator must compare with the fresh worker-derived address for this complete enrollment before signing.",
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

/** Fixed locally compiled v1 contract: no constructor, proxy, admin, external link or funds. */
export async function prepareUnsignedRegistryDeployment(deployer: string, releaseCommit: string) {
  address.parse(deployer); z.string().regex(/^[0-9a-f]{40}$/).parse(releaseCommit);
  const artifact = validateRegistryArtifact(
    await readUnsignedSetupJson(fileURLToPath(new URL("./fixtures/mainnet-source-registry.json", import.meta.url)), 65_536),
    (await readBoundedRegularBytes(fileURLToPath(new URL("../contracts/source-registry.sol", import.meta.url)), 16_384)).toString("utf8"));
  return { format: "keryx-mainnet-unsigned-setup-v1", operation: "deploy", networkId: network.networkId, releaseCommit,
    ...notice, provenance: { contract: "SourceRegistry", sourceName: "contracts/source-registry.sol", compiler: artifact.compiler,
      sourceSha256Lf: artifact.sourceSha256Lf, compilerInputSha256: sha256(canonicalJson(artifact.compilerInput)),
      creationBytecodeKeccak256: keccak256(artifact.bytecode), runtimeBytecodeKeccak256: keccak256(artifact.deployedBytecode),
      compilerSettings: { evmVersion: "paris", optimizer: { enabled: true, runs: 200 } } },
    deployedBytecode: artifact.deployedBytecode, abi: artifact.abi, transactions: [tx(deployer, null, artifact.bytecode)] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && args[0] === "--help")) {
    console.log("Offline unsigned setup only; never signs or broadcasts.\nUsage:\n  npm run mainnet:unsigned-setup -- deploy <public-deployer-address> <release-commit>\n  npm run mainnet:unsigned-setup -- prepare <public-enrollment-json> <public-operation-json>\nGas/nonce/fees and actual chain/owner/source/fresh-worker evidence remain separate operator gates.");
  } else {
    try {
      if (args.length !== 3) throw new Error("setup refused");
      let result;
      if (args[0] === "deploy") {
        assertReviewedRelease(args[2]); result = await prepareUnsignedRegistryDeployment(args[1], args[2]);
      } else if (args[0] === "prepare") {
        const enrollment = parsePublicMainnetEnrollment(await readUnsignedSetupJson(args[1]));
        assertReviewedRelease(enrollment.releaseCommit);
        result = await prepareUnsignedPilotSetup(enrollment, await readUnsignedSetupJson(args[2]));
      }
      if (!result) throw new Error("setup refused");
      console.log(JSON.stringify(result, null, 2));
    } catch { console.error("Unsigned setup unavailable or refused; no private detail retained."); process.exitCode = 2; }
  }
}
