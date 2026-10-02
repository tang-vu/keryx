import { afterEach, expect, it, vi } from "vitest";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData, erc20Abi, parseAbi } from "viem";
import { ARC_MAINNET_PROFILE } from "../lib/arc-network-profile";
import { assertReviewedRelease, prepareUnsignedMainnetOperation, prepareUnsignedRegistryDeployment, readUnsignedSetupJson, validateRegistryArtifact } from "./mainnet-unsigned-setup.mjs";
const creator = `0x${"11".repeat(20)}`, payout = `0x${"22".repeat(20)}`, registry = `0x${"33".repeat(20)}`, signer = `0x${"44".repeat(20)}`, release = "aa".repeat(20);
const directories: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const source = { kind: "register", creator, canonicalUrl: "https://creator.example/feed", payoutWallet: payout,
  authors: [{ wallet: payout, basisPoints: 10_000 }], fetchPriceMicros: "10000", contentCid: "", tags: "research" };
it("prepares ordinary creator registration without invitation lists or pilot price caps", () => {
  const result = prepareUnsignedMainnetOperation(release, registry, { ...source, fetchPriceMicros: "1000000" });
  const transaction = result.transactions[0]; expect(transaction).toMatchObject({ chainId: 5042, from: creator, to: registry, valueNativeAtomic: "0" });
  expect(decodeFunctionData({ abi: parseAbi(["function register(bytes32,address,(address wallet,uint16 basisPoints)[],uint64,string,string)"]), data: transaction.data }).args?.[3]).toBe(BigInt(1_000_000));
  expect(result).toMatchObject({ unsignedOnly: true, broadcast: false, launchAuthorized: false });
  expect(() => prepareUnsignedMainnetOperation(release, registry, { ...source, fetchPriceMicros: "0" })).not.toThrow();
});
it("uses exact uint64 price and the contract's 20-author limit with integer splits", () => {
  const authors = Array.from({ length: 20 }, (_, index) => ({ wallet: `0x${(index + 1).toString(16).padStart(40, "0")}`, basisPoints: 500 }));
  expect(() => prepareUnsignedMainnetOperation(release, registry, { ...source, authors, fetchPriceMicros: "18446744073709551615" })).not.toThrow();
  for (const invalid of ["18446744073709551616", "1.2", "001", 100]) expect(() => prepareUnsignedMainnetOperation(release, registry, { ...source, fetchPriceMicros: invalid })).toThrow();
  expect(() => prepareUnsignedMainnetOperation(release, registry, { ...source, authors: [...authors, authors[0]] })).toThrow();
  expect(() => prepareUnsignedMainnetOperation(release, registry, { ...source, authors: [{ wallet: payout, basisPoints: 9999 }] })).toThrow();
});
it("emits exact approval and depositFor micro-USDC for the separately reviewed signer", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const result = prepareUnsignedMainnetOperation(release, registry, { kind: "fund", owner: creator, sessionSigner: signer, amountMicros: "10000000" });
  expect(decodeFunctionData({ abi: erc20Abi, data: result.transactions[0].data }).args).toEqual([ARC_MAINNET_PROFILE.gatewayWallet, BigInt(10_000_000)]);
  expect(decodeFunctionData({ abi: parseAbi(["function depositFor(address token,address depositor,uint256 value)"]), data: result.transactions[1].data }).args).toEqual([ARC_MAINNET_PROFILE.usdcAddress, signer, BigInt(10_000_000)]);
  expect(result.gas).toMatchObject({ nativeDecimals: 18, estimate: null, includedInResearchCap: false }); expect(fetch).not.toHaveBeenCalled();
});
it("pins local reviewed source, compiler/settings and full bytecode provenance", async () => {
  const artifact = JSON.parse(await readFile(new URL("./fixtures/mainnet-source-registry.json", import.meta.url), "utf8"));
  const source = await readFile(new URL("../contracts/source-registry.sol", import.meta.url), "utf8");
  expect(validateRegistryArtifact(artifact, source)).toEqual(artifact);
  expect(() => validateRegistryArtifact(artifact, source + "\n// changed")).toThrow();
  expect(() => validateRegistryArtifact({ ...artifact, compiler: "0.8.26" }, source)).toThrow();
  expect(() => validateRegistryArtifact({ ...artifact, compilerInput: { ...artifact.compilerInput, settings: {} } }, source)).toThrow();
  const deployment = await prepareUnsignedRegistryDeployment(creator, release);
  expect(deployment.transactions[0]).toMatchObject({ chainId: 5042, from: creator, to: null });
  expect(deployment.provenance.runtimeBytecodeKeccak256).toBe("0x4fffb030de9d91ff1638b3a0c6b452d67d7794765b53babfc3a6bd20e6ae1949");
});
it("refuses edited or untracked release source before CLI emission", async () => {
  const repo = await mkdtemp(join(tmpdir(), "keryx-mainnet-git-")); directories.push(repo);
  const git = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: "pipe" });
  git(["init"]); await writeFile(join(repo, "source.txt"), "source"); git(["add", "source.txt"]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"]);
  const head = git(["rev-parse", "HEAD"]).trim(); expect(() => assertReviewedRelease(head, repo)).not.toThrow();
  expect(() => assertReviewedRelease(release, repo)).toThrow(); await writeFile(join(repo, "new.ts"), "new source");
  expect(() => assertReviewedRelease(head, repo)).toThrow();
});
it("bounds public file intake and returns fixed CLI error without echoing private paths or contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "keryx-mainnet-input-")); directories.push(directory);
  const file = join(directory, "private-marker.json"); await writeFile(file, "private-value-marker");
  await expect(readUnsignedSetupJson(file)).rejects.toThrow(); await writeFile(file, "x".repeat(16_385));
  await expect(readUnsignedSetupJson(file)).rejects.toThrow(); await expect(readUnsignedSetupJson(directory)).rejects.toThrow();
  const result = execFileSync(process.execPath, ["--import", "tsx", "scripts/mainnet-unsigned-setup.mts", "--help"], { cwd: process.cwd(), encoding: "utf8" });
  expect(result).toContain("never signs or broadcasts"); expect(result).not.toContain("private-marker");
  const refused = spawnSync(process.execPath, ["--import", "tsx", "scripts/mainnet-unsigned-setup.mts", "private-value-marker", file], { cwd: process.cwd(), encoding: "utf8" });
  expect(refused.status).toBe(2); expect(refused.stdout).toBe("");
  expect(refused.stderr.trim()).toBe("Unsigned setup unavailable or refused; no private detail retained.");
});
