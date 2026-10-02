import { afterEach, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createWithdrawalRequest } from "../lib/gateway/withdrawal-request";
import { withdrawTypedData } from "../lib/gateway/withdraw-protocol";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { creatorBatchOwnerKey, creatorBatchManifestSchema, creatorBatchPlanDigest, prepareCreatorBatchPlan, validateCreatorBatchPlan } from "./creator-cashout-batch-plan";
import { creatorBatchPublisherKey, signCreatorBatchOriginals, retainedCreatorBatchOriginal } from "./creator-cashout-batch-signing";
import { inspectCreatorBatchDirectory, readCreatorBatchJson, validateCreatorBatchWindowsAncestorAcl } from "./creator-cashout-batch-files";
import { creatorBatchBroadcastOnce, queueCreatorBatchMints } from "./creator-cashout-batch-mint";
import { creatorWithdrawalFixture } from "./test-fixtures/creator-withdrawal";
import { createWithdrawalMintJournal } from "../lib/gateway/withdrawal-mint-journal";
import { withCreatorBatchStore } from "./creator-cashout-batch-store";
import { withNewWithdrawalDrillStore } from "./creator-withdrawal-drill-store";
import { readWithdrawalHeightWindow } from "../lib/gateway/withdrawal-height-window";
import { estimateWithdrawalIntent } from "../lib/gateway/withdrawal-estimate";

const directories: string[] = [], signal = () => new AbortController().signal;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const contracts = { domain: 26, gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const,
  gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as const, asset: "0x3600000000000000000000000000000000000000" as const };
function manifest() {
  const key = generatePrivateKey(), account = privateKeyToAccount(key);
  return { key, account, value: { format: "creator-cashout-batch-manifest-v1" as const, network: "eip155:5042002" as const,
    maxTotalDebitMicros: "53850", maxFeeMicros: "3900" as const, owners: [{ owner: account.address, availableMicros: "53850", label: "Original creator", sourceName: "Original source" }] } };
}
async function planned() {
  const f = manifest();
  const balance = vi.fn(async () => BigInt("53850")), height = vi.fn(async () => ({ minimumBlockHeight: "10500", maximumBlockHeight: "12000" }));
  const estimate = vi.fn(async candidate => ({ ...candidate, maxBlockHeight: "11000", maxFee: "3850" }));
  const plan = await prepareCreatorBatchPlan(f.value, contracts, { balance, height, estimate });
  return { ...f, plan, balance, height, estimate };
}
function privateDirectory() {
  const testParent = process.platform === "win32" ? join(homedir(), ".codex", "private") : tmpdir();
  if (process.platform === "win32") mkdirSync(testParent, { recursive: true });
  const directory = mkdtempSync(join(testParent, "keryx-creator-batch-")); directories.push(directory);
  if (process.platform === "linux") chmodSync(directory, 0o700);
  if (process.platform === "win32") {
    const sid = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8", windowsHide: true }).trim();
    execFileSync("icacls.exe", [directory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"], { windowsHide: true });
  }
  return directory;
}
it("enforces canonical exact integer total, unique owners, 23/55 bounds and self-owned manifest fields", () => {
  const f = manifest(); expect(creatorBatchManifestSchema.parse(f.value).owners[0].owner).toBe(f.account.address.toLowerCase());
  for (const change of [{ maxTotalDebitMicros: "53849" }, { maxTotalDebitMicros: "55000001" }, { maxTotalDebitMicros: "1e6" }, { maxFeeMicros: "3901" },
    { owners: [...f.value.owners, ...f.value.owners] }, { owners: [{ ...f.value.owners[0], recipient: privateKeyToAccount(generatePrivateKey()).address }] }])
    expect(() => creatorBatchManifestSchema.parse({ ...f.value, ...change })).toThrow();
});
it("solves bounded unsigned fee fixed point and retains exact full debit plus finite identity", async () => {
  const f = await planned(); expect(f.estimate).toHaveBeenCalledTimes(2);
  expect(f.plan.drafts[0].burnIntent).toMatchObject({ maxBlockHeight: "11000", maxFee: "3850", spec: { value: "50000" } });
  expect(BigInt(f.plan.drafts[0].burnIntent.spec.value) + BigInt(f.plan.drafts[0].burnIntent.maxFee)).toBe(BigInt(f.value.maxTotalDebitMicros));
  expect(validateCreatorBatchPlan(f.plan)).toEqual(f.plan);
  const changed = structuredClone(f.plan); changed.manifest.owners[0].label = "Changed label";
  expect(creatorBatchPlanDigest(changed)).not.toBe(creatorBatchPlanDigest(f.plan));
  changed.drafts[0].burnIntent.spec.value = "49999"; expect(() => validateCreatorBatchPlan(changed)).toThrow();
});
it("prepares with complete fresh RPC observation metadata through the real strict estimator", async () => {
  const f = manifest(), abort = signal();
  const block = { number: BigInt(10000), hash: `0x${"ab".repeat(32)}` as const,
    timestamp: BigInt(Math.floor(Date.now() / 1000)) };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://gateway-api-testnet.circle.com/v1/info") return Response.json({ domains: [{
      domain: 26, chain: "Arc", network: "Testnet", processedHeight: "9999", burnIntentExpirationHeight: "10500",
      walletContract: { address: contracts.gatewayWallet, supportedTokens: ["USDC"] },
      minterContract: { address: contracts.gatewayMinter, supportedTokens: ["USDC"] },
    }] });
    expect(url).toBe("https://gateway-api-testnet.circle.com/v1/estimate");
    expect(init?.method).toBe("POST");
    const [{ spec }] = JSON.parse(init?.body as string);
    expect(Object.keys(JSON.parse(init?.body as string)[0])).toEqual(["spec"]);
    return Response.json([{ burnIntent: { spec, maxBlockHeight: "11000", maxFee: "3850" } }]);
  });
  vi.stubGlobal("fetch", fetcher);
  const height = await readWithdrawalHeightWindow(() => ({ getChainId: async () => 5042002,
    getBlock: async () => block } as unknown as ReturnType<Parameters<typeof readWithdrawalHeightWindow>[0]>), contracts,
    { maxAheadBlocks: "2000", maxProcessingLagBlocks: "100" }, abort);
  expect(height).toMatchObject({ minimumBlockHeight: "10500", maximumBlockHeight: "12000",
    observedBlockNumber: "10000", observedBlockHash: block.hash, observedAt: expect.any(String) });
  const plan = await prepareCreatorBatchPlan(f.value, contracts, { balance: async () => BigInt("53850"),
    height: async () => height, estimate: (candidate, policy, bounds) => estimateWithdrawalIntent(candidate, policy, bounds, abort) });
  expect(plan.drafts[0].burnIntent).toMatchObject({ maxBlockHeight: "11000", maxFee: "3850", spec: { value: "50000" } });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["https://gateway-api-testnet.circle.com/v1/info",
    "https://gateway-api-testnet.circle.com/v1/estimate", "https://gateway-api-testnet.circle.com/v1/estimate"]);
});
it("rejects insufficient balances, excess fees, unlimited expiry and unstable quote convergence before signing", async () => {
  const f = manifest(), height = async () => ({ minimumBlockHeight: "10500", maximumBlockHeight: "12000" });
  const balance = async () => BigInt("53850");
  for (const fee of ["3901", "99999"]) await expect(prepareCreatorBatchPlan(f.value, contracts, { balance, height,
    estimate: async candidate => ({ ...candidate, maxBlockHeight: "11000", maxFee: fee }) })).rejects.toThrow();
  await expect(prepareCreatorBatchPlan(f.value, contracts, { balance: async () => null, height,
    estimate: async candidate => candidate })).rejects.toThrow();
  await expect(prepareCreatorBatchPlan(f.value, contracts, { balance, height, estimate: async candidate => candidate })).rejects.toThrow();
  let index = 0;
  await expect(prepareCreatorBatchPlan(f.value, contracts, { balance, height,
    estimate: async candidate => ({ ...candidate, maxBlockHeight: "11000", maxFee: ++index % 2 ? "3850" : "3800" }) })).rejects.toThrow();
  expect(index).toBe(5);
});
it("keeps selected debit and policy unchanged when preparation observes later credits or a smaller surplus", async () => {
  const f = await planned();
  const balance = vi.fn<() => Promise<bigint | null>>().mockResolvedValueOnce(BigInt("63850")).mockResolvedValueOnce(BigInt("54850"));
  const plan = await prepareCreatorBatchPlan(f.value, contracts, { balance, height: f.height, estimate: f.estimate });
  expect(balance).toHaveBeenCalledTimes(2);
  expect(plan.manifest).toEqual(f.plan.manifest); expect(plan.drafts[0].policy).toEqual(f.plan.drafts[0].policy);
  expect(plan.manifest.maxTotalDebitMicros).toBe("53850");
  expect(plan.drafts[0].burnIntent).toMatchObject({ maxFee: "3850", spec: { value: "50000" } });
});
it("refuses unknown or below-selected balance at either preparation observation", async () => {
  const f = await planned();
  for (const unavailable of [null, BigInt("53849")]) for (const position of [0, 1]) {
    const balance = vi.fn<() => Promise<bigint | null>>().mockResolvedValueOnce(position === 0 ? unavailable : BigInt("63850"))
      .mockResolvedValueOnce(unavailable);
    const estimate = vi.fn(candidate => f.estimate(candidate));
    await expect(prepareCreatorBatchPlan(f.value, contracts, { balance, height: f.height, estimate })).rejects.toThrow();
    expect(balance).toHaveBeenCalledTimes(position + 1);
    expect(estimate).toHaveBeenCalledTimes(position === 0 ? 0 : 2);
  }
});
it("prepares all 23 reviewed owners without widening any individual or total capacity", async () => {
  const owners = Array.from({ length: 23 }, (_, index) => ({ owner: privateKeyToAccount(generatePrivateKey()).address,
    availableMicros: "2000000", label: `Synthetic ${index}` }));
  const input = { format: "creator-cashout-batch-manifest-v1", network: "eip155:5042002", maxTotalDebitMicros: "46000000", maxFeeMicros: "3900", owners };
  const plan = await prepareCreatorBatchPlan(input, contracts, { balance: async () => BigInt("2000000"),
    height: async () => ({ minimumBlockHeight: "10500", maximumBlockHeight: "12000" }),
    estimate: async candidate => ({ ...candidate, maxBlockHeight: "11000", maxFee: "3850" }) });
  expect(plan.drafts).toHaveLength(23); expect(new Set(plan.drafts.map(row => row.id)).size).toBe(23);
  expect(plan.drafts.reduce((sum, row) => sum + BigInt(row.burnIntent.spec.value) + BigInt(row.burnIntent.maxFee), BigInt(0))).toBe(BigInt("46000000"));
  expect(() => creatorBatchManifestSchema.parse({ ...input, owners: [...owners, manifest().value.owners[0]] })).toThrow();
});
it("uses derived address rather than labels and selects only one original publisher env field", () => {
  const f = manifest(), foreign = manifest();
  expect(creatorBatchOwnerKey({ misleading: { address: f.account.address, privateKey: f.key } }, f.account.address)).toBe(f.key);
  expect(() => creatorBatchOwnerKey({ a: { address: f.account.address, privateKey: foreign.key } }, f.account.address)).toThrow();
  expect(() => creatorBatchOwnerKey({ a: { address: f.account.address, privateKey: f.key }, b: { address: f.account.address, privateKey: f.key } }, f.account.address)).toThrow();
  expect(creatorBatchPublisherKey(`KERYX_RPC_URL=https://quarantined.invalid\nKERYX_PUBLISHER_PRIVATE_KEY='${f.key}'\nOTHER_KEY=${foreign.key}`, f.account.address)).toBe(f.key);
  expect(() => creatorBatchPublisherKey(`KERYX_PUBLISHER_PRIVATE_KEY=${f.key}\nKERYX_PUBLISHER_PRIVATE_KEY=${f.key}`, f.account.address)).toThrow();
  expect(() => creatorBatchPublisherKey(`KERYX_PUBLISHER_PRIVATE_KEY=${foreign.key}`, f.account.address)).toThrow();
});
it("distinguishes harmless Windows ancestor reads/create-child/inherit-only from replacement rights", () => {
  const acl = { current: "owner", owner: "owner", attributes: 16, trustedInstaller: "installer", rules: [{ sid: "foreign", type: "Allow", rights: 131241 | 4, propagation: 0 }] };
  expect(() => validateCreatorBatchWindowsAncestorAcl(acl)).not.toThrow();
  for (const rights of [2, 16, 64, 256, 65536, 262144, 524288, 0x10000000, 0x40000000]) {
    expect(() => validateCreatorBatchWindowsAncestorAcl({ ...acl, rules: [{ ...acl.rules[0], rights }] })).toThrow();
    expect(() => validateCreatorBatchWindowsAncestorAcl({ ...acl, rules: [{ ...acl.rules[0], rights, propagation: 2 }] })).not.toThrow();
  }
  expect(() => validateCreatorBatchWindowsAncestorAcl({ ...acl, owner: "foreign" })).toThrow();
  expect(() => validateCreatorBatchWindowsAncestorAcl({ ...acl, rules: [{ ...acl.rules[0], rights: 65536 }] }, true)).not.toThrow();
  expect(() => validateCreatorBatchWindowsAncestorAcl({ ...acl, rules: [{ ...acl.rules[0], rights: 64 }] }, true)).toThrow();
});
it("signs one unfunded original, verifies durable readback and never signs it again", async () => {
  const f = await planned(), directory = privateDirectory(); await inspectCreatorBatchDirectory(directory);
  const dependencies = { key: vi.fn(() => f.key), balance: f.balance, height: async () => ({ minimumBlockHeight: "10500", maximumBlockHeight: "12000" }) };
  expect((await signCreatorBatchOriginals(directory, f.plan, undefined, dependencies, signal()))[0].state).toBe("signed-original-retained");
  expect((await retainedCreatorBatchOriginal(directory, f.plan.drafts[0])).id).toBe(f.plan.drafts[0].id);
  dependencies.key.mockClear(); f.balance.mockClear();
  expect((await signCreatorBatchOriginals(directory, f.plan, undefined, dependencies, signal()))[0].state).toBe("original-retained");
  expect(dependencies.key).not.toHaveBeenCalled(); expect(f.balance).not.toHaveBeenCalled();
});
it("signs only the selected original despite later credits and never renews it", async () => {
  const f = await planned(), directory = privateDirectory(), digest = creatorBatchPlanDigest(f.plan), draft = f.plan.drafts[0];
  const key = vi.fn(() => f.key), balance = vi.fn<() => Promise<bigint | null>>().mockResolvedValue(BigInt("63850"));
  const deps = { key, balance, height: f.height };
  expect((await signCreatorBatchOriginals(directory, f.plan, undefined, deps, signal()))[0].state).toBe("signed-original-retained");
  const original = await retainedCreatorBatchOriginal(directory, draft);
  expect(original.policy).toEqual(draft.policy); expect(original.request.burnIntent).toEqual(draft.burnIntent);
  expect(original.request.burnIntent).toMatchObject({ maxFee: "3850", spec: { value: "50000" } });
  expect(creatorBatchPlanDigest(f.plan)).toBe(digest);
  key.mockClear(); balance.mockClear(); balance.mockResolvedValue(null);
  expect((await signCreatorBatchOriginals(directory, f.plan, undefined, deps, signal()))[0].state).toBe("original-retained");
  expect(key).not.toHaveBeenCalled(); expect(balance).not.toHaveBeenCalled();
  expect(await retainedCreatorBatchOriginal(directory, draft)).toEqual(original);
});
it("refuses unknown or below-selected signing balance before creating a marker or original", async () => {
  const f = await planned(), directory = privateDirectory(), draft = f.plan.drafts[0], height = vi.fn(() => f.height());
  for (const available of [null, BigInt("53849")]) {
    const results = await signCreatorBatchOriginals(directory, f.plan, undefined,
      { key: () => f.key, balance: async () => available, height }, signal());
    expect(results[0].state).toBe("unavailable-original-retained");
    expect(existsSync(join(directory, `sign-attempt-${draft.id}.json`))).toBe(false);
    expect(existsSync(join(directory, `original-${draft.id}.json`))).toBe(false);
  }
  expect(height).not.toHaveBeenCalled();
});
it("retains interrupted signing marker, rejects foreign keys/drift and never manufactures an original", async () => {
  const f = await planned(), directory = privateDirectory(), id = f.plan.drafts[0].id;
  writeFileSync(join(directory, `sign-attempt-${id}.json`), JSON.stringify({ requestId: id }), { mode: 0o600 });
  const deps = { key: () => f.key, balance: f.balance, height: async () => ({ minimumBlockHeight: "10500", maximumBlockHeight: "12000" }) };
  expect((await signCreatorBatchOriginals(directory, f.plan, undefined, deps, signal()))[0].state).toBe("unavailable-original-retained");
  expect(existsSync(join(directory, `original-${id}.json`))).toBe(false);
  expect(JSON.parse(readFileSync(join(directory, `sign-attempt-${id}.json`), "utf8"))).toEqual({ requestId: id });
  expect((await signCreatorBatchOriginals(directory, f.plan, undefined, { ...deps, balance: async () => BigInt("63850") }, signal()))[0].state).toBe("unavailable-original-retained");
  expect(existsSync(join(directory, `original-${id}.json`))).toBe(false);
  expect(JSON.parse(readFileSync(join(directory, `sign-attempt-${id}.json`), "utf8"))).toEqual({ requestId: id });
  const other = privateDirectory();
  expect((await signCreatorBatchOriginals(other, f.plan, undefined, { ...deps, key: () => generatePrivateKey() }, signal()))[0].state).toBe("unavailable-original-retained");
  expect((await signCreatorBatchOriginals(other, f.plan, undefined, { ...deps, balance: async () => BigInt("53849") }, signal()))[0].state).toBe("unavailable-original-retained");
  expect(existsSync(join(other, `sign-attempt-${id}.json`))).toBe(false);
});
it("retains a one-broadcast marker on response loss and rejects later replay or foreign raw bytes", async () => {
  const f = await planned(), directory = privateDirectory(), draft = f.plan.drafts[0];
  const original = await createWithdrawalRequest({ burnIntent: draft.burnIntent, signature: await f.account.signTypedData(withdrawTypedData(draft.burnIntent)) }, draft.policy);
  writeFileSync(join(directory, `original-${draft.id}.json`), JSON.stringify(original), { mode: 0o600 });
  const raw = "0x02abcd" as const, hash = `0x${"ab".repeat(32)}` as const;
  const journal = { listRequestIds: () => [draft.id], getPrepared: async () => ({ serializedTransaction: raw, transactionHash: hash }) };
  const send = vi.fn(async () => { throw new Error("Synthetic lost response"); });
  const broadcast = creatorBatchBroadcastOnce(directory, journal as never, f.plan, send, signal());
  await expect(broadcast({ serializedTransaction: raw })).rejects.toThrow("Synthetic lost response");
  await expect(broadcast({ serializedTransaction: raw })).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
  await expect(broadcast({ serializedTransaction: "0x02aaaa" })).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(readFileSync(join(directory, `broadcast-attempt-${draft.id}.json`), "utf8"))).toEqual({ requestId: draft.id, transactionHash: hash });
});
it("queues only gas-estimated originals, isolates one failure and skips prior slots on the next pass", async () => {
  const first = await creatorWithdrawalFixture(), second = await creatorWithdrawalFixture(), directory = privateDirectory();
  const signer = privateKeyToAccount(generatePrivateKey()), db = new DatabaseSync(":memory:");
  try {
    const journal = createWithdrawalMintJournal(db, { format: "creator-mint-journal-v1", chainId: 5042002, relayer: signer.address,
      initialNonce: 0, lifetimeGasBudgetWei: "18000000000000000", maxSlots: 2 }, { initialize: true });
    for (const f of [first, second]) await journal.admitGas(f.record, "9000000000000000", signal());
    const responses = new Map<string, typeof first.response>([[first.record.id, first.response], [second.record.id, second.response]]);
    const store = { getCreatorWithdrawalAttestation: async (id: string) => responses.get(id) ?? null };
    const estimate = vi.fn(async held => { if (held.request.id === first.record.id) throw new Error("Synthetic revert"); return BigInt(150000); });
    const terms = { relayer: signer.address, gas: "300000", maxFeePerGas: "30000000000", maxPriorityFeePerGas: "5000000000", gasBudgetWei: "9000000000000000" };
    const queue = await queueCreatorBatchMints(directory, journal, store as never, terms, estimate, signal());
    expect(queue.estimateUnavailableIds).toEqual([first.record.id]); expect(journal.listRequestIds()).toEqual([second.record.id]);
    estimate.mockClear(); await queueCreatorBatchMints(directory, journal, store as never, terms, estimate, signal());
    expect(estimate).toHaveBeenCalledTimes(1); expect(estimate.mock.calls[0][0].request.id).toBe(first.record.id);
    expect(journal.gasAdmissionSummary().committedGasWei).toBe("18000000000000000");
  } finally { db.close(); }
});
it.skipIf(process.platform !== "linux")("opens only initialized private batch stores without replacing missing history", async () => {
  const directory = privateDirectory(), application = join(directory, "application"); mkdirSync(application, { mode: 0o700 });
  const database = join(application, "keryx.sqlite");
  await withNewWithdrawalDrillStore(database, async () => {});
  await expect(withCreatorBatchStore(database, async store => store.listPayments(10), true)).resolves.toEqual([]);
  const missing = join(application, "missing.sqlite"); await expect(withCreatorBatchStore(missing, async () => {})).rejects.toThrow();
  expect(existsSync(missing)).toBe(false);
});
it.skipIf(process.platform !== "win32")("observes real Windows DACL privacy and refuses parent replacement authority", async () => {
  const parent = privateDirectory(), directory = join(parent, "signed"); mkdirSync(directory);
  await expect(inspectCreatorBatchDirectory(directory)).resolves.toBe(directory);
  const file = join(directory, "fixture.json"); writeFileSync(file, JSON.stringify({ synthetic: true }));
  await expect(readCreatorBatchJson(file)).resolves.toEqual({ synthetic: true });
  const redirect = join(parent, "redirect"); symlinkSync(directory, redirect, "junction");
  await expect(inspectCreatorBatchDirectory(redirect)).rejects.toThrow();
  await expect(readCreatorBatchJson(join(redirect, "fixture.json"))).rejects.toThrow();
  execFileSync("icacls.exe", [parent, "/grant:r", "*S-1-1-0:(OI)(CI)M"], { windowsHide: true });
  await expect(readCreatorBatchJson(file)).rejects.toThrow();
});
