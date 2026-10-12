import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, getContractAddress, keccak256, toBytes, type Hex } from "viem";
import { parseSponsorDeploymentFlags, prepareSponsorDeployment, readSponsorDeploymentBytes, sponsorDeploymentReader,
  validateCompiledSponsorRegistry, verifySimulatedSponsorRuntime, writeSponsorDeploymentPacket,
  type SponsorDeploymentOptions, type SponsorDeploymentReader } from "./prepare-registration-sponsor-deployment.mjs";

const sender = "0xca5b29b4f8bfbbd027ddc8516914a262f7ef6478" as const;
const registry = "0x42a64061b6cd84067bb660b2a9b8aa881fd225bb" as const;
const sourceName = "contracts/source-registry-v3.sol", eip712 = "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const directories: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

// Synthetic compiler/RPC records verify review orchestration; they establish no funded receipt.
const immutableNames = ["_cachedDomainSeparator", "_cachedChainId", "_cachedThis", "_hashedName", "_hashedVersion", "_name", "_version"];
const runtimeTemplate = `0x6001${"0".repeat(64 * immutableNames.length)}6002` as Hex;
const abi = [{ type: "function", name: "registerWithSignature" }, { type: "function", name: "registryVersion" }];
function inputs() {
  const artifact = { _format: "hh-sol-artifact-1", sourceName, contractName: "SourceRegistryV3", abi,
    bytecode: "0x60006000", deployedBytecode: runtimeTemplate, linkReferences: {}, deployedLinkReferences: {} };
  const build = { _format: "hh-sol-build-info-1", solcVersion: "0.8.24", solcLongVersion: "0.8.24+commit.e11b9ed9",
    input: { language: "Solidity", sources: { [sourceName]: { content: "creator-signed registration" }, [eip712]: { content: "domain separation" } },
      settings: { evmVersion: "paris", optimizer: { enabled: true, runs: 200 }, outputSelection: {} } },
    output: { contracts: { [sourceName]: { SourceRegistryV3: { abi, evm: { bytecode: { object: "60006000" },
      deployedBytecode: { object: runtimeTemplate.slice(2), immutableReferences: Object.fromEntries(immutableNames.map((_, index) =>
        [String(index + 1), [{ start: 2 + index * 32, length: 32 }]])) } } } } },
      sources: { [eip712]: { ast: { nodes: immutableNames.map((name, index) =>
        ({ nodeType: "VariableDeclaration", name, id: index + 1, mutability: "immutable" })) } } } } };
  const artifactBytes = Buffer.from(JSON.stringify(artifact)), buildInfoBytes = Buffer.from(JSON.stringify(build));
  const options: SponsorDeploymentOptions = { network: "arc", sender, releaseCommit: "a".repeat(40),
    artifactSha256: sha256(artifactBytes), buildInfoSha256: sha256(buildInfoBytes), maxGas: "2200000", maxFeePerGasWei: "40000000000",
    maxPriorityFeePerGasWei: "1", maxLiabilityWei: "88000000000000000", currentRegistry: { address: registry, codeHash: keccak256("0x6000") } };
  return { artifact, build, artifactBytes, buildInfoBytes, options };
}
const readSource = async (name: string) => name === sourceName ? "creator-signed registration" : "domain separation";
async function fixture() {
  const values = inputs();
  const compiled = await validateCompiledSponsorRegistry(values.artifactBytes, values.buildInfoBytes, values.options, readSource);
  return { ...values, compiled };
}
const predicted = getContractAddress({ from: sender, nonce: BigInt(2) });
const hashedName = keccak256(toBytes("KeryxSourceRegistry")), hashedVersion = keccak256(toBytes("3"));
const domainSeparator = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
  [keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")), hashedName, hashedVersion, BigInt(5042), predicted]));
const runtime = `0x6001${domainSeparator.slice(2)}${BigInt(5042).toString(16).padStart(64, "0")}${predicted.slice(2).toLowerCase().padStart(64, "0")}${hashedName.slice(2)}${hashedVersion.slice(2)}${Buffer.from("KeryxSourceRegistry").toString("hex").padEnd(62, "0")}${Buffer.byteLength("KeryxSourceRegistry").toString(16).padStart(2, "0")}33${"0".repeat(60)}016002` as Hex;
function chain(overrides: Partial<Record<string, unknown>> = {}) {
  const requests: { method: string; params: unknown[] }[] = [];
  const read: SponsorDeploymentReader = async (method, params) => {
    requests.push({ method, params });
    if (method in overrides) return overrides[method];
    if (method === "eth_chainId") return "0x13b2";
    if (method === "eth_getBlockByNumber") return { number: "0x10", hash: `0x${"b".repeat(64)}`, baseFeePerGas: "0x4a817c800", gasLimit: "0x1c9c380" };
    if (method === "eth_getBalance") return "0x16345785d8a0000";
    if (method === "eth_getTransactionCount") return "0x2";
    if (method === "eth_estimateGas") return "0x1e2a91";
    if (method === "eth_getCode") return "0x6000";
    if (method === "eth_call") return (params[0] as { to?: string }).to ? `0x${"2".padStart(64, "0")}` : runtime;
    throw new Error("No writer in fixture");
  };
  return { read, requests };
}

it("pins compiler inputs, reviewed artifact bytes and exact creation/runtime output before RPC", async () => {
  const f = await fixture(); expect(f.compiled.immutableRanges).toHaveLength(7);
  await expect(validateCompiledSponsorRegistry(Buffer.from("{}"), f.buildInfoBytes, f.options, readSource)).rejects.toThrow();
  await expect(validateCompiledSponsorRegistry(f.artifactBytes, f.buildInfoBytes, f.options, async () => "edited source")).rejects.toThrow();
  for (const mutate of [(value: ReturnType<typeof inputs>) => { value.build.solcVersion = "0.8.26"; },
    (value: ReturnType<typeof inputs>) => { value.artifact.bytecode = "0x6001"; },
    (value: ReturnType<typeof inputs>) => { value.build.input.settings.optimizer.runs = 1; }]) {
    const value = inputs(); mutate(value);
    const artifact = Buffer.from(JSON.stringify(value.artifact)), build = Buffer.from(JSON.stringify(value.build));
    await expect(validateCompiledSponsorRegistry(artifact, build, { ...value.options, artifactSha256: sha256(artifact), buildInfoSha256: sha256(build) }, readSource)).rejects.toThrow();
  }
});
it("retains two old listings as an open source-specific authority gate, with exact native liability", async () => {
  const f = await fixture(), c = chain();
  const packet = await prepareSponsorDeployment(f.options, f.compiled, c.read, "2026-10-12T02:17:46.246Z");
  expect(packet).toMatchObject({ unsignedOnly: true, broadcast: false, fundingAuthorized: false, registryCutoverAuthorized: false,
    financialAcceptance: "not-performed", currentRegistry: { sourceCount: "2" },
    gates: { legacyListingContinuity: "source-specific-authority-design-required", cutover: "closed" },
    transaction: { from: sender, nonce: "2", valueWei: "0", predictedRegistryAddress: predicted, maximumLiabilityWei: "88000000000000000" },
    observation: { estimatedGas: "1976977", nativeDecimals: 18, estimatedFeeAtObservedBaseWei: "39539540000000000" } });
  expect(packet.provenance.runtimeCodeHash).toBe(keccak256(runtime));
  expect(c.requests.some(request => /send|sign|broadcast/i.test(request.method))).toBe(false);
  expect(c.requests.filter(request => request.method === "eth_call").every(request => request.params[1] === "0x10")).toBe(true);
});
it("refuses mutation of every EIP-712 immutable, runtime code, CREATE address and chain", async () => {
  const { compiled } = await fixture();
  expect(verifySimulatedSponsorRuntime(compiled, runtime, predicted, 5042)).toBe(runtime);
  for (const value of [runtime.replace(/^0x6001/, "0x6003"), runtimeTemplate, runtime + "00"])
    expect(() => verifySimulatedSponsorRuntime(compiled, value, predicted, 5042)).toThrow();
  expect(() => verifySimulatedSponsorRuntime(compiled, runtime, predicted, 5042002)).toThrow();
  for (const range of compiled.immutableRanges) {
    const position = 2 + range.start * 2;
    const altered = runtime.slice(0, position) + (runtime.slice(position, position + 2) === "ff" ? "00" : "ff") + runtime.slice(position + 2);
    expect(() => verifySimulatedSponsorRuntime(compiled, altered, predicted, 5042)).toThrow();
  }
});
it("refuses wrong rail, another pending nonce, inadequate fee/gas cap and changed legacy code", async () => {
  const f = await fixture();
  for (const overrides of [{ eth_chainId: "0x4cef52" }, { eth_estimateGas: "0x300000" }, { eth_getCode: "0x6001" }])
    await expect(prepareSponsorDeployment(f.options, f.compiled, chain(overrides).read)).rejects.toThrow();
  const c = chain(), read: SponsorDeploymentReader = (method, params) => method === "eth_getTransactionCount" && params[1] === "pending"
    ? Promise.resolve("0x3") : c.read(method, params);
  await expect(prepareSponsorDeployment(f.options, f.compiled, read)).rejects.toThrow();
  await expect(prepareSponsorDeployment({ ...f.options, maxFeePerGasWei: "20000000000" }, f.compiled, c.read)).rejects.toThrow();
  await expect(prepareSponsorDeployment({ ...f.options, maxLiabilityWei: "1" }, f.compiled, c.read)).rejects.toThrow();
});
it("rejects nonce changes after simulation and never treats balance as funding approval", async () => {
  const f = await fixture(), c = chain({ eth_getBalance: "0x0" });
  const packet = await prepareSponsorDeployment(f.options, f.compiled, c.read);
  expect(packet.observation.senderCoversMaximumLiability).toBe(false); expect(packet.fundingAuthorized).toBe(false);
  let calls = 0;
  const read: SponsorDeploymentReader = (method, params) => method === "eth_getTransactionCount" && ++calls > 2
    ? Promise.resolve("0x3") : c.read(method, params);
  await expect(prepareSponsorDeployment(f.options, f.compiled, read)).rejects.toThrow();
  const changedBlock: SponsorDeploymentReader = async (method, params) => {
    const value = await c.read(method, params);
    return method === "eth_getBlockByNumber" && params[0] !== "latest" ? { ...value as Record<string, unknown>, hash: `0x${"c".repeat(64)}` } : value;
  };
  await expect(prepareSponsorDeployment(f.options, f.compiled, changedBlock)).rejects.toThrow();
});
it("attests after response, rejects RPC writes and credential-bearing URLs before networking", async () => {
  const requested: string[] = [];
  let chainReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); requested.push(body.method);
    const result = body.method === "eth_chainId" ? (++chainReads === 2 ? "0x4cef52" : "0x13b2") : "0x2";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }));
  const reader = sponsorDeploymentReader("https://rpc.blockdaemon.mainnet.arc.io", 5042);
  await expect(reader("eth_getTransactionCount", [sender, "latest"])).rejects.toThrow();
  await expect(reader("eth_sendRawTransaction" as never, ["private-marker"])).rejects.toThrow();
  expect(requested).not.toContain("eth_sendRawTransaction");
  for (const url of ["http://rpc.example", "https://secret:password@rpc.example", "https://rpc.example?key=secret"])
    expect(() => sponsorDeploymentReader(url, 5042)).toThrow();
});
it("requires explicit mainnet continuity inputs and never overwrites a review packet", async () => {
  const f = await fixture(), directory = await mkdtemp(join(tmpdir(), "keryx-sponsor-packet-")); directories.push(directory);
  const args = ["--network", "arc", "--sender", sender, "--release-commit", f.options.releaseCommit,
    "--artifact", join(directory, "artifact.json"), "--artifact-sha256", f.options.artifactSha256,
    "--build-info", join(directory, "build.json"), "--build-info-sha256", f.options.buildInfoSha256,
    "--rpc", "https://rpc.blockdaemon.mainnet.arc.io", "--max-gas", "2200000", "--max-fee-per-gas-wei", "40000000000",
    "--max-priority-fee-per-gas-wei", "1", "--max-liability-wei", "88000000000000000", "--output", join(directory, "packet.json")];
  expect(() => parseSponsorDeploymentFlags(args)).toThrow();
  const complete = [...args, "--current-registry", registry, "--current-registry-code-hash", f.options.currentRegistry!.codeHash];
  expect(parseSponsorDeploymentFlags(complete).options.network).toBe("arc");
  expect(() => parseSponsorDeploymentFlags([...complete, "--sender", sender])).toThrow();
  expect(() => parseSponsorDeploymentFlags([...complete, "--private-key", "private-marker"])).toThrow();
  const output = join(directory, "packet.json"), packet = { unsignedOnly: true, broadcast: false };
  await writeSponsorDeploymentPacket(output, packet); const original = await readFile(output);
  await expect(writeSponsorDeploymentPacket(output, { changed: true })).rejects.toThrow(); expect(await readFile(output)).toEqual(original);
  await writeFile(join(directory, "large.json"), "x".repeat(100));
  await expect(readSponsorDeploymentBytes(join(directory, "large.json"), 10)).rejects.toThrow();
  await expect(readSponsorDeploymentBytes(directory, 1000)).rejects.toThrow();
});
it("CLI help loads no env files or signer and refusal prints no private argument", () => {
  const result = execFileSync(process.execPath, ["--import", "tsx", "scripts/prepare-registration-sponsor-deployment.mts", "--help"], { encoding: "utf8" });
  expect(result).toContain("never signs or broadcasts"); expect(result).toContain("loads no .env files");
  const denied = spawnSync(process.execPath, ["--import", "tsx", "scripts/prepare-registration-sponsor-deployment.mts", "--private-key", "private-marker"], { encoding: "utf8" });
  expect(denied.status).toBe(2); expect(denied.stdout).toBe("");
  expect(denied.stderr.trim()).toBe("Unsigned registration sponsor deployment unavailable or refused; no private detail retained.");
});
