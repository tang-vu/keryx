/** Explicit unsigned V3 deployment review. No environment loader, custody or RPC writes. */
import { createHash } from "node:crypto";
import { readFile, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { encodeAbiParameters, encodeFunctionData, getContractAddress, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../lib/arc-network-profile";
import { canonicalJson } from "../lib/canonical-json";
import { assertReviewedRelease } from "./mainnet-unsigned-setup.mjs";

const SOURCE = "contracts/source-registry-v3.sol", CONTRACT = "SourceRegistryV3";
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(value => !/^0x0{40}$/i.test(value)).transform(value => value.toLowerCase() as Address);
const hex = z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).max(100_000).transform(value => value.toLowerCase() as Hex);
const codeHash = z.string().regex(/^0x[0-9a-f]{64}$/);
const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(value => BigInt(value) < BigInt(2) ** BigInt(256));
const positive = uint.refine(value => BigInt(value) > BigInt(0));
export const sponsorDeploymentOptionsSchema = z.object({
  network: z.enum(["arc", "arcTestnet"]), sender: address, releaseCommit: z.string().regex(/^[0-9a-f]{40}$/),
  artifactSha256: digest, buildInfoSha256: digest,
  maxGas: positive.refine(value => BigInt(value) <= BigInt(10_000_000)),
  maxFeePerGasWei: positive.refine(value => BigInt(value) >= BigInt(20_000_000_000)),
  maxPriorityFeePerGasWei: uint, maxLiabilityWei: positive,
  currentRegistry: z.object({ address, codeHash }).strict().optional(),
}).strict().refine(value => BigInt(value.maxPriorityFeePerGasWei) <= BigInt(value.maxFeePerGasWei) &&
  BigInt(value.maxGas) * BigInt(value.maxFeePerGasWei) <= BigInt(value.maxLiabilityWei) &&
  (value.network !== "arc" || !!value.currentRegistry), "Deployment limits or registry evidence unavailable");
export type SponsorDeploymentOptions = z.infer<typeof sponsorDeploymentOptionsSchema>;
type ImmutableRange = { start: number; length: number };
const IMMUTABLE_NAMES = ["_cachedDomainSeparator", "_cachedChainId", "_cachedThis", "_hashedName", "_hashedVersion", "_name", "_version"] as const;
type ImmutableName = typeof IMMUTABLE_NAMES[number];
export type CompiledSponsorRegistry = {
  bytecode: Hex; runtimeTemplate: Hex; immutableRanges: ImmutableRange[];
  immutableSlots: Record<ImmutableName, ImmutableRange[]>; compilerInputSha256: string; sourceSha256Lf: string;
};
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const normalized = (source: string) => source.replace(/\r\n/g, "\n");
const fail = (): never => { throw new Error("Unsigned sponsor deployment refused"); };
const object = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  return input as Record<string, unknown>;
};

/** Artifact and build-info digests are explicit reviewer inputs, not source-acceptance claims. */
export async function validateCompiledSponsorRegistry(artifactBytes: Buffer, buildInfoBytes: Buffer,
  options: SponsorDeploymentOptions, readSource: (name: string) => Promise<string>): Promise<CompiledSponsorRegistry> {
  if (sha256(artifactBytes) !== options.artifactSha256 || sha256(buildInfoBytes) !== options.buildInfoSha256) fail();
  const artifact = object(JSON.parse(artifactBytes.toString("utf8"))), build = object(JSON.parse(buildInfoBytes.toString("utf8")));
  if (artifact._format !== "hh-sol-artifact-1" || artifact.sourceName !== SOURCE || artifact.contractName !== CONTRACT ||
    canonicalJson(artifact.linkReferences) !== "{}" || canonicalJson(artifact.deployedLinkReferences) !== "{}" ||
    build._format !== "hh-sol-build-info-1" || build.solcVersion !== "0.8.24" || build.solcLongVersion !== "0.8.24+commit.e11b9ed9") fail();
  const input = object(build.input), settings = object(input.settings), sources = object(input.sources);
  if (input.language !== "Solidity" || canonicalJson(settings.optimizer) !== '{"enabled":true,"runs":200}' ||
    settings.evmVersion !== "paris" || Object.keys(settings).sort().join(",") !== "evmVersion,optimizer,outputSelection" || !sources[SOURCE]) fail();
  for (const [name, value] of Object.entries(sources)) {
    if (!/^(?:contracts\/|@openzeppelin\/contracts\/)[a-zA-Z0-9_./-]+\.sol$/.test(name) || name.split("/").includes("..")) fail();
    if (normalized(String(object(value).content)) !== normalized(await readSource(name))) fail();
  }
  const output = object(build.output), compiled = object(object(object(output.contracts)[SOURCE])[CONTRACT]);
  const evm = object(compiled.evm), creation = object(evm.bytecode), runtime = object(evm.deployedBytecode);
  const bytecode = hex.parse(artifact.bytecode), runtimeTemplate = hex.parse(artifact.deployedBytecode);
  if (bytecode !== `0x${creation.object}` || runtimeTemplate !== `0x${runtime.object}` ||
    canonicalJson(artifact.abi) !== canonicalJson(compiled.abi) || runtimeTemplate.length > 2 + 24_576 * 2 ||
    !Array.isArray(artifact.abi) || !artifact.abi.some(item => object(item).name === "registerWithSignature") ||
    !artifact.abi.some(item => object(item).name === "registryVersion")) fail();
  const immutableReferences = object(runtime.immutableReferences);
  const rangeSchema = z.array(z.object({ start: z.number().int().nonnegative(), length: z.literal(32) }).strict()).min(1).max(64);
  const rangesById = new Map(Object.entries(immutableReferences).map(([id, ranges]) => [id, rangeSchema.parse(ranges)]));
  const immutableRanges = [...rangesById.values()].flat().sort((a, b) => a.start - b.start);
  if (!immutableRanges.length || immutableRanges.some((range, index) => range.start + range.length > (runtimeTemplate.length - 2) / 2 ||
    (index > 0 && immutableRanges[index - 1].start + immutableRanges[index - 1].length > range.start))) fail();
  const eip712 = object(object(output.sources)["@openzeppelin/contracts/utils/cryptography/EIP712.sol"]);
  const variables = new Map<string, string>();
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const record = object(node);
    if (record.nodeType === "VariableDeclaration" && record.mutability === "immutable" && typeof record.name === "string")
      variables.set(record.name, String(record.id));
    Object.values(record).forEach(visit);
  }
  visit(eip712.ast);
  if (rangesById.size !== IMMUTABLE_NAMES.length || variables.size !== IMMUTABLE_NAMES.length) fail();
  const immutableSlots = Object.fromEntries(IMMUTABLE_NAMES.map(name => {
    const ranges = rangesById.get(variables.get(name) ?? "");
    if (!ranges?.length) return fail();
    return [name, ranges];
  })) as Record<ImmutableName, ImmutableRange[]>;
  return { bytecode, runtimeTemplate, immutableRanges, immutableSlots,
    compilerInputSha256: sha256(canonicalJson(input)), sourceSha256Lf: sha256(normalized(String(object(sources[SOURCE]).content))) };
}

export type SponsorDeploymentReadMethod = "eth_chainId" | "eth_getBlockByNumber" | "eth_getBalance" |
  "eth_getTransactionCount" | "eth_estimateGas" | "eth_call" | "eth_getCode";
export type SponsorDeploymentReader = (method: SponsorDeploymentReadMethod, params: unknown[]) => Promise<unknown>;
const READ_METHODS = new Set<SponsorDeploymentReadMethod>(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance",
  "eth_getTransactionCount", "eth_estimateGas", "eth_call", "eth_getCode"]);
/** Attest both sides of every read. Unknown methods never reach the network. */
export function sponsorDeploymentReader(rpcUrl: string, chainId: 5042 | 5042002): SponsorDeploymentReader {
  const url = new URL(rpcUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) fail();
  async function raw(method: SponsorDeploymentReadMethod, params: unknown[]) {
    if (!READ_METHODS.has(method)) fail();
    const response = await fetch(url, { method: "POST", redirect: "error", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) fail();
    const body = object(await response.json());
    if (body.error || !Object.hasOwn(body, "result")) fail();
    return body.result;
  }
  const assertChain = async () => { if (quantity(await raw("eth_chainId", [])) !== BigInt(chainId)) fail(); };
  return async (method, params) => {
    if (!READ_METHODS.has(method)) fail();
    await assertChain(); const result = await raw(method, params); await assertChain(); return result;
  };
}
function quantity(input: unknown): bigint {
  if (typeof input !== "string" || !/^0x[0-9a-fA-F]+$/.test(input)) return fail();
  return BigInt(input);
}
const rpcQuantity = (value: bigint) => `0x${value.toString(16)}`;
/** The real runtime contains EIP-712 immutables for this exact CREATE address and chain. */
export function verifySimulatedSponsorRuntime(compiled: CompiledSponsorRegistry, simulated: unknown, predictedAddress: Address, chainId: number): Hex {
  const runtime = hex.parse(simulated);
  if (runtime.length !== compiled.runtimeTemplate.length) fail();
  const expected = compiled.runtimeTemplate.slice(2), observed = runtime.slice(2);
  let cursor = 0;
  for (const range of compiled.immutableRanges) {
    if (expected.slice(cursor * 2, range.start * 2) !== observed.slice(cursor * 2, range.start * 2)) fail();
    cursor = range.start + range.length;
  }
  if (expected.slice(cursor * 2) !== observed.slice(cursor * 2)) fail();
  if (Object.keys(compiled.immutableSlots).sort().join(",") !== [...IMMUTABLE_NAMES].sort().join(",") ||
    canonicalJson(Object.values(compiled.immutableSlots).flat().sort((a, b) => a.start - b.start)) !== canonicalJson(compiled.immutableRanges)) fail();
  const hashedName = keccak256(toBytes("KeryxSourceRegistry")), hashedVersion = keccak256(toBytes("3"));
  const domainSeparator = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")), hashedName, hashedVersion, BigInt(chainId), predictedAddress]));
  const shortString = (value: string) => Buffer.from(value, "utf8").toString("hex").padEnd(62, "0") + Buffer.byteLength(value).toString(16).padStart(2, "0");
  const expectedImmutables: Record<ImmutableName, string> = {
    _cachedDomainSeparator: domainSeparator.slice(2), _cachedChainId: BigInt(chainId).toString(16).padStart(64, "0"),
    _cachedThis: predictedAddress.slice(2).toLowerCase().padStart(64, "0"), _hashedName: hashedName.slice(2), _hashedVersion: hashedVersion.slice(2),
    _name: shortString("KeryxSourceRegistry"), _version: shortString("3"),
  };
  for (const name of IMMUTABLE_NAMES)
    for (const range of compiled.immutableSlots[name])
      if (observed.slice(range.start * 2, (range.start + range.length) * 2) !== expectedImmutables[name]) fail();
  return runtime;
}

export async function prepareSponsorDeployment(optionsInput: SponsorDeploymentOptions, compiled: CompiledSponsorRegistry,
  read: SponsorDeploymentReader, observedAt = new Date().toISOString()) {
  const options = sponsorDeploymentOptionsSchema.parse(optionsInput);
  const profile = options.network === "arc" ? ARC_MAINNET_PROFILE : ARC_TESTNET_PROFILE;
  if (quantity(await read("eth_chainId", [])) !== BigInt(profile.chainId)) fail();
  const block = object(await read("eth_getBlockByNumber", ["latest", false]));
  const blockNumber = rpcQuantity(quantity(block.number)), blockHash = codeHash.parse(block.hash), baseFeeWei = quantity(block.baseFeePerGas);
  const [latest, pending, balance] = await Promise.all([
    read("eth_getTransactionCount", [options.sender, blockNumber]), read("eth_getTransactionCount", [options.sender, "pending"]),
    read("eth_getBalance", [options.sender, blockNumber]),
  ]);
  const nonce = quantity(latest), senderBalanceWei = quantity(balance);
  if (nonce !== quantity(pending) || BigInt(options.maxGas) > quantity(block.gasLimit) ||
    BigInt(options.maxFeePerGasWei) < baseFeeWei + BigInt(options.maxPriorityFeePerGasWei)) fail();
  const predictedAddress = getContractAddress({ from: options.sender, nonce });
  if (options.currentRegistry?.address === predictedAddress.toLowerCase()) fail();
  const call = { from: options.sender, data: compiled.bytecode, value: "0x0" };
  const [estimate, runtimeResult] = await Promise.all([
    read("eth_estimateGas", [call, blockNumber]), read("eth_call", [{ ...call, gas: rpcQuantity(BigInt(options.maxGas)) }, blockNumber]),
  ]);
  const estimatedGas = quantity(estimate);
  if (estimatedGas <= BigInt(21_000) || estimatedGas > BigInt(options.maxGas)) fail();
  const runtime = verifySimulatedSponsorRuntime(compiled, runtimeResult, predictedAddress, profile.chainId);
  let currentRegistry: { address: Address; codeHash: string; sourceCount: string; blockNumber: string; blockHash: string } | null = null;
  if (options.currentRegistry) {
    const [code, count] = await Promise.all([
      read("eth_getCode", [options.currentRegistry.address, blockNumber]),
      read("eth_call", [{ to: options.currentRegistry.address, data: encodeFunctionData({ abi: parseAbi(["function sourceCount() view returns (uint256)"]), functionName: "sourceCount" }) }, blockNumber]),
    ]);
    if (keccak256(hex.parse(code)) !== options.currentRegistry.codeHash || typeof count !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(count)) fail();
    currentRegistry = { ...options.currentRegistry, sourceCount: quantity(count).toString(), blockNumber: quantity(blockNumber).toString(), blockHash };
  }
  // A changed deployer nonce invalidates both CREATE address and constructor runtime evidence.
  if (quantity(await read("eth_getTransactionCount", [options.sender, "latest"])) !== nonce ||
    quantity(await read("eth_getTransactionCount", [options.sender, "pending"])) !== nonce ||
    quantity(await read("eth_chainId", [])) !== BigInt(profile.chainId)) fail();
  const finalBlock = object(await read("eth_getBlockByNumber", [blockNumber, false]));
  if (quantity(finalBlock.number) !== quantity(blockNumber) || codeHash.parse(finalBlock.hash) !== blockHash) fail();
  const transactionLiabilityWei = BigInt(options.maxGas) * BigInt(options.maxFeePerGasWei);
  return { format: "keryx-registration-sponsor-unsigned-deployment-v1", unsignedOnly: true, broadcast: false,
    fundingAuthorized: false, registryCutoverAuthorized: false, sponsorshipActivated: false, financialAcceptance: "not-performed",
    releaseCommit: options.releaseCommit, network: profile.networkId, observedAt,
    provenance: { contract: CONTRACT, sourceName: SOURCE, compiler: "0.8.24+commit.e11b9ed9", compilerSettings: { evmVersion: "paris", optimizer: { enabled: true, runs: 200 } },
      artifactSha256: options.artifactSha256, buildInfoSha256: options.buildInfoSha256, compilerInputSha256: compiled.compilerInputSha256,
      sourceSha256Lf: compiled.sourceSha256Lf, creationBytecodeKeccak256: keccak256(compiled.bytecode), runtimeCodeHash: keccak256(runtime) },
    observation: { blockNumber: quantity(blockNumber).toString(), blockHash, senderBalanceWei: senderBalanceWei.toString(),
      baseFeePerGasWei: baseFeeWei.toString(), estimatedGas: estimatedGas.toString(), nativeDecimals: 18,
      estimatedFeeAtObservedBaseWei: (estimatedGas * baseFeeWei).toString(), senderCoversMaximumLiability: senderBalanceWei >= transactionLiabilityWei },
    transaction: { chainId: profile.chainId, type: "eip1559", from: options.sender, to: null, nonce: nonce.toString(),
      predictedRegistryAddress: predictedAddress, valueWei: "0", data: compiled.bytecode, gas: options.maxGas,
      maxFeePerGasWei: options.maxFeePerGasWei, maxPriorityFeePerGasWei: options.maxPriorityFeePerGasWei,
      maximumLiabilityWei: transactionLiabilityWei.toString(), ownerDeclaredCeilingWei: options.maxLiabilityWei },
    simulatedRuntime: runtime, currentRegistry,
    gates: { exactSourceReviewAndCI: "required", ownerDeploymentApproval: "required", dedicatedSponsorCustodyAndFiniteAllowance: "required",
      fundedTestnetAndOriginalRecoveryAcceptance: "required", deployedRuntimeAndReceiptReadback: "required",
      legacyListingContinuity: currentRegistry && BigInt(currentRegistry.sourceCount) > BigInt(0) ? "source-specific-authority-design-required" : "review-required",
      cutover: "closed" },
  };
}

const FLAGS = ["network", "sender", "release-commit", "artifact", "artifact-sha256", "build-info", "build-info-sha256", "rpc",
  "max-gas", "max-fee-per-gas-wei", "max-priority-fee-per-gas-wei", "max-liability-wei", "current-registry", "current-registry-code-hash", "output"] as const;
export function parseSponsorDeploymentFlags(args: string[]) {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith("--") || !FLAGS.includes(key as typeof FLAGS[number]) || !value || value.startsWith("--") || key in values) fail();
    values[key] = value;
  }
  for (const key of FLAGS.filter(key => !key.startsWith("current-registry"))) if (!values[key]) fail();
  if (!!values["current-registry"] !== !!values["current-registry-code-hash"] ||
    ![values.artifact, values["build-info"], values.output].every(isAbsolute)) fail();
  const options = sponsorDeploymentOptionsSchema.parse({ network: values.network, sender: values.sender, releaseCommit: values["release-commit"],
    artifactSha256: values["artifact-sha256"], buildInfoSha256: values["build-info-sha256"], maxGas: values["max-gas"],
    maxFeePerGasWei: values["max-fee-per-gas-wei"], maxPriorityFeePerGasWei: values["max-priority-fee-per-gas-wei"], maxLiabilityWei: values["max-liability-wei"],
    ...(values["current-registry"] ? { currentRegistry: { address: values["current-registry"], codeHash: values["current-registry-code-hash"] } } : {}) });
  return { values, options };
}
/** Fresh public artifact only; never overwrite an existing file or follow a linked ancestor. */
export async function writeSponsorDeploymentPacket(output: string, packet: unknown) {
  if (!isAbsolute(output)) fail();
  const absolute = resolve(output), root = parse(absolute).root;
  let directory = dirname(absolute);
  while (directory !== root) {
    const status = await lstat(directory); if (!status.isDirectory() || status.isSymbolicLink()) fail();
    directory = dirname(directory);
  }
  const bytes = Buffer.from(JSON.stringify(packet, null, 2) + "\n");
  const handle = await open(absolute, "wx", 0o644);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  return sha256(bytes);
}

export async function readSponsorDeploymentBytes(path: string, limit: number): Promise<Buffer> {
  const selected = await lstat(path);
  if (!selected.isFile() || selected.isSymbolicLink() || selected.size < 2 || selected.size > limit) fail();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== selected.size || before.ino !== selected.ino || before.dev !== selected.dev ||
      before.mtimeMs !== selected.mtimeMs || before.ctimeMs !== selected.ctimeMs) fail();
    const bytes = Buffer.alloc(limit + 1), read = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
    if (read.bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail();
    return bytes.subarray(0, read.bytesRead);
  } finally { await handle.close(); }
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    console.log("Unsigned V3 deployment review; never signs or broadcasts, loads no .env files.\n" +
      "node --import tsx scripts/prepare-registration-sponsor-deployment.mts\n" + FLAGS.map(flag => `  --${flag} <explicit-public-value>`).join("\n") +
      "\nCurrent registry/address hash are mandatory on mainnet. Artifact/build-info/output paths must be absolute; output must be fresh. All gas and fees use 18-decimal native wei."); return;
  }
  try {
    const { values, options } = parseSponsorDeploymentFlags(process.argv.slice(2));
    const repo = fileURLToPath(new URL("../", import.meta.url)); assertReviewedRelease(options.releaseCommit, repo);
    const [artifact, buildInfo] = await Promise.all([readSponsorDeploymentBytes(values.artifact, 1_048_576),
      readSponsorDeploymentBytes(values["build-info"], 16_777_216)]);
    const compiled = await validateCompiledSponsorRegistry(artifact, buildInfo, options,
      name => readFile(resolve(repo, name.startsWith("contracts/") ? name : `node_modules/${name}`), "utf8"));
    const chainId = options.network === "arc" ? 5042 : 5042002;
    const packet = await prepareSponsorDeployment(options, compiled, sponsorDeploymentReader(values.rpc, chainId));
    const packetDigest = await writeSponsorDeploymentPacket(values.output, packet);
    console.log(`Unsigned V3 deployment packet written; SHA256 ${packetDigest}. Deployment, funding, sponsorship and cutover remain unapproved.`);
  } catch { console.error("Unsigned registration sponsor deployment unavailable or refused; no private detail retained."); process.exitCode = 2; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
