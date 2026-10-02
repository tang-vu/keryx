import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, erc20Abi, keccak256, parseAbi, toBytes } from "viem";
import { ARC_MAINNET_PROFILE } from "../lib/arc-network-profile";
import { publicMainnetEnrollmentDigest } from "../lib/mainnet-pilot/public-enrollment";
import { assertReviewedRelease, prepareUnsignedPilotSetup, prepareUnsignedRegistryDeployment, readUnsignedSetupJson, validateRegistryArtifact } from "./mainnet-pilot-unsigned-setup.mjs";

const owner = `0x${"11".repeat(20)}` as const, signer = `0x${"22".repeat(20)}` as const,
  creator = `0x${"33".repeat(20)}` as const, payout = `0x${"44".repeat(20)}` as const,
  retained = `0x${"55".repeat(20)}` as const, registry = `0x${"66".repeat(20)}` as const;
const source = { kind: "register" as const, creator, canonicalUrl: "https://source.example.invalid/public-feed",
  payoutWallet: payout, authors: [{ wallet: payout, basisPoints: 10_000 }], fetchPriceMicros: 100,
  contentCid: "ipfs://synthetic-fixture", tags: "fixture" };
const urlHash = keccak256(toBytes(source.canonicalUrl));
const sourceId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [creator, urlHash]));
const enrollment = () => ({ format: "keryx-mainnet-enrollment-v1", candidateDigest: "77".repeat(32), releaseCommit: "88".repeat(20),
  origin: "https://pilot.example.invalid", network: ARC_MAINNET_PROFILE, registryAddress: registry, invitedBuyers: [owner],
  retainedTestnetSigners: [retained], approvedSourceIds: [sourceId], approvedCreatorAddresses: [creator], approvedPayoutAddresses: [payout],
  limits: { totalMicros: 1_000_000, perBuyerMicros: 250_000, perAskMicros: 50_000, perPaymentMicros: 10_000, maxAsks: 20 },
  epoch: "fixture", expiresAtSeconds: 2_000_000_000 });
const fund = () => ({ kind: "fund", owner, sessionSigner: signer, amountMicros: 200_000 });
const directories: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("offline unsigned mainnet setup", () => {
  it("refuses a wrong release, tracked edits and nonignored new source before emission", async () => {
    const repo = await mkdtemp(join(tmpdir(), "keryx-unsigned-git-")); directories.push(repo);
    const git = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: "pipe" });
    git(["init"]); await writeFile(join(repo, "source.txt"), "fixture\n"); git(["add", "source.txt"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"]);
    const head = git(["rev-parse", "HEAD"]).trim(); expect(() => assertReviewedRelease(head, repo)).not.toThrow();
    expect(() => assertReviewedRelease("00".repeat(20), repo)).toThrow();
    await writeFile(join(repo, "source.txt"), "changed\n"); expect(() => assertReviewedRelease(head, repo)).toThrow();
    git(["restore", "source.txt"]); await writeFile(join(repo, "new-source.ts"), "unreviewed source");
    expect(() => assertReviewedRelease(head, repo)).toThrow(); await rm(join(repo, "new-source.ts"));
    await writeFile(join(repo, ".git", "info", "exclude"), "handoff.local\n"); await writeFile(join(repo, "handoff.local"), "public local note");
    expect(() => assertReviewedRelease(head, repo)).not.toThrow();
  });

  it("encodes exact ERC20 approval and Gateway depositFor for the fresh signer, never the owner", async () => {
    const rpc = vi.fn(() => { throw new Error("unexpected network"); }); vi.stubGlobal("fetch", rpc);
    const prepared = await prepareUnsignedPilotSetup(enrollment(), fund());
    expect(prepared.enrollmentDigest).toBe(await publicMainnetEnrollmentDigest(enrollment()));
    expect(prepared.enrollmentDigest).not.toBe(enrollment().candidateDigest);
    expect(prepared.transactions).toHaveLength(2);
    const [approve, deposit] = prepared.transactions;
    expect(approve).toMatchObject({ chainId: 5042, from: owner, to: ARC_MAINNET_PROFILE.usdcAddress, valueNativeAtomic: "0" });
    expect(decodeFunctionData({ abi: erc20Abi, data: approve.data })).toMatchObject({ functionName: "approve", args: [ARC_MAINNET_PROFILE.gatewayWallet, BigInt(200_000)] });
    expect(deposit).toMatchObject({ chainId: 5042, from: owner, to: ARC_MAINNET_PROFILE.gatewayWallet, valueNativeAtomic: "0" });
    expect(decodeFunctionData({ abi: parseAbi(["function depositFor(address token,address depositor,uint256 value)"]), data: deposit.data })).toMatchObject({ functionName: "depositFor", args: [ARC_MAINNET_PROFILE.usdcAddress, signer, BigInt(200_000)] });
    expect(prepared).toMatchObject({ launchAuthorized: false, broadcast: false, unsignedOnly: true, gas: { nativeDecimals: 18, estimate: null, includedInResearchCap: false } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the creator-bound registry ID and exact integer splits from approved public source fields", async () => {
    const result = await prepareUnsignedPilotSetup(enrollment(), source);
    expect(result).toMatchObject({ sourceId, urlHash, operation: "register" });
    expect(result.transactions[0]).toMatchObject({ from: creator, to: registry, chainId: 5042 });
    const abi = parseAbi(["function register(bytes32,address,(address wallet,uint16 basisPoints)[],uint64,string,string)"]);
    expect(decodeFunctionData({ abi, data: result.transactions[0].data }).args).toEqual([urlHash, payout, [{ wallet: payout, basisPoints: 10_000 }], BigInt(100), source.contentCid, source.tags]);
  });

  it.each([
    { owner: creator }, { sessionSigner: owner }, { sessionSigner: retained }, { amountMicros: 250_001 },
    { amountMicros: 1.5 }, { amountMicros: 0 }, { amountMicros: "200000" }, { secret: "never echo" },
  ])("refuses unsafe funding declarations %j", async change => {
    await expect(prepareUnsignedPilotSetup(enrollment(), { ...fund(), ...change })).rejects.toThrow();
  });

  it.each([
    { creator: owner }, { payoutWallet: signer }, { canonicalUrl: "https://other.example.invalid" },
    { authors: [{ wallet: signer, basisPoints: 10_000 }] }, { authors: [{ wallet: payout, basisPoints: 9999 }] },
    { authors: [{ wallet: payout, basisPoints: 5000 }, { wallet: payout, basisPoints: 5000 }] },
    { fetchPriceMicros: 10_001 }, { fetchPriceMicros: 0 },
    { authors: Array.from({ length: 6 }, (_, i) => ({ wallet: `0x${String(i + 1).repeat(40)}`, basisPoints: i === 5 ? 5000 : 1000 })) },
    { contentCid: "é".repeat(65) }, { tags: "é".repeat(129) },
  ])("refuses unapproved or invalid registry requests %j", async change => {
    await expect(prepareUnsignedPilotSetup(enrollment(), { ...source, ...change })).rejects.toThrow();
  });

  it("binds the complete artifact rather than a candidate label, and retains mainnet-only schema enforcement", async () => {
    const before = await prepareUnsignedPilotSetup(enrollment(), fund());
    const after = await prepareUnsignedPilotSetup({ ...enrollment(), epoch: "new" }, fund());
    expect(after.enrollmentDigest).not.toBe(before.enrollmentDigest);
    await expect(prepareUnsignedPilotSetup({ ...enrollment(), network: { ...ARC_MAINNET_PROFILE, chainId: 5042002 } }, fund())).rejects.toThrow();
  });

  it("emits the fixed locally compiled constructor-free artifact with reproducible source and bytecode provenance", async () => {
    const result = await prepareUnsignedRegistryDeployment(owner, enrollment().releaseCommit);
    const artifact = JSON.parse(await readFile(new URL("./fixtures/mainnet-source-registry.json", import.meta.url), "utf8"));
    const sourceText = (await readFile(new URL("../contracts/source-registry.sol", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    expect(artifact.compilerInput.sources["contracts/source-registry.sol"].content).toBe(sourceText);
    expect(result.provenance.sourceSha256Lf).toBe(createHash("sha256").update(sourceText).digest("hex"));
    expect(result.provenance).toMatchObject({ compiler: "0.8.24+commit.e11b9ed9", creationBytecodeKeccak256: keccak256(artifact.bytecode), runtimeBytecodeKeccak256: keccak256(artifact.deployedBytecode) });
    expect(result.transactions[0]).toMatchObject({ chainId: 5042, from: owner, to: null, data: artifact.bytecode, valueNativeAtomic: "0" });
    expect(artifact.abi.some((entry: { type: string }) => entry.type === "constructor")).toBe(false);
    await expect(prepareUnsignedRegistryDeployment(owner, "short")).rejects.toThrow();
  });

  it("refuses stale source, altered compiler settings and unreviewed curated bytecode", async () => {
    const artifact = JSON.parse(await readFile(new URL("./fixtures/mainnet-source-registry.json", import.meta.url), "utf8"));
    const actual = await readFile(new URL("../contracts/source-registry.sol", import.meta.url), "utf8");
    expect(() => validateRegistryArtifact(artifact, actual)).not.toThrow();
    expect(() => validateRegistryArtifact(artifact, actual.replace(/\r?\n/g, "\r\n"))).not.toThrow();
    expect(() => validateRegistryArtifact(artifact, actual + "\n// different release source\n")).toThrow();
    for (const mutate of [
      (a: typeof artifact) => { a.compiler = "0.8.26"; },
      (a: typeof artifact) => { a.compilerInput.settings.optimizer.runs = 201; },
      (a: typeof artifact) => { a.compilerInput.settings.evmVersion = "shanghai"; },
      (a: typeof artifact) => { a.compilerInput.sources["contracts/source-registry.sol"].content += "\n"; },
      (a: typeof artifact) => { a.bytecode = "0x6000"; },
      (a: typeof artifact) => { a.abi = []; },
    ]) { const changed = structuredClone(artifact); mutate(changed); expect(() => validateRegistryArtifact(changed, actual)).toThrow(); }
  });

  it("reads only explicit bounded regular files and gives fixed redacted CLI failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keryx-unsigned-")); directories.push(directory);
    const invalid = join(directory, "private-name.json"); await writeFile(invalid, "not JSON private value");
    const result = execFileSync(process.execPath, ["--import", "tsx", "scripts/mainnet-pilot-unsigned-setup.mts", "--help"], { encoding: "utf8", env: { ...process.env, KERYX_NETWORK: "arc", BUYER_PRIVATE_KEY: "poison-unused" } });
    expect(result).toContain("Offline unsigned setup only"); expect(result).not.toContain("poison");
    try { execFileSync(process.execPath, ["--import", "tsx", "scripts/mainnet-pilot-unsigned-setup.mts", "prepare", invalid, invalid], { encoding: "utf8", stdio: "pipe" }); throw new Error("expected refusal"); }
    catch (error) { expect((error as { stderr: string }).stderr.trim()).toBe("Unsigned setup unavailable or refused; no private detail retained."); }
    await writeFile(invalid, " ".repeat(16_385)); await expect(readUnsignedSetupJson(invalid)).rejects.toThrow();
    await expect(readUnsignedSetupJson(directory)).rejects.toThrow();
  });

  it.skipIf(process.platform === "win32")("refuses symlinks and FIFOs without opening them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keryx-unsigned-")); directories.push(directory);
    const target = join(directory, "target.json"), link = join(directory, "link"), fifo = join(directory, "fifo");
    await writeFile(target, "{}"); await symlink(target, link); execFileSync("mkfifo", [fifo]);
    await expect(readUnsignedSetupJson(link)).rejects.toThrow(); await expect(readUnsignedSetupJson(fifo)).rejects.toThrow();
  });
});
