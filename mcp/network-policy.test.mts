import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function selected(network: "arc" | "arcTestnet") {
  vi.resetModules();
  vi.stubEnv("KERYX_NETWORK", network); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", network);
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", undefined);
  vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", undefined);
}
function journal(value: unknown) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-rail-journal-")); directories.push(directory);
  const file = path.join(directory, "original.json"); fs.writeFileSync(file, JSON.stringify(value)); return file;
}
const legacyPayment = { queryId: `a2a_${"a".repeat(64)}`, authorizationId: `0x${"a".repeat(64)}`,
  amountUsdc: "0.08", status: "unconfirmed" };
const legacyFunding = { schema: "keryx-mcp-funding-v1", id: "11111111-1111-4111-8111-111111111111",
  payer: `0x${"11".repeat(20)}`, amountMicros: "100000", requiredMicros: "100000", phase: "deposit", status: "pending" };
it("captures canonical mainnet independently of seller challenges", async () => {
  selected("arc"); const { callerProfile, callerChain, assertCallerJournalNetwork } = await import("./network-policy.mts");
  expect(callerChain.id).toBe(5042); expect(callerProfile.networkId).toBe("eip155:5042");
  expect(() => assertCallerJournalNetwork("eip155:5042002")).toThrow(/different network/);
  expect(() => assertCallerJournalNetwork()).toThrow(/different network/);
});
it("preserves legacy testnet originals and refuses mainnet recovery before any fetch", async () => {
  selected("arc"); const payment = await import("./local-payment.mts"), funding = await import("./local-funding.mts");
  const file = journal(legacyPayment), fundingFile = journal(legacyFunding), original = fs.readFileSync(file), originalFunding = fs.readFileSync(fundingFile);
  const fetchImpl = vi.fn(); vi.stubGlobal("fetch", fetchImpl);
  await expect(payment.recoverResearch("https://example.test", file, fetchImpl)).rejects.toThrow(/different network/);
  await expect(funding.recoverFunding(fundingFile, "https://synthetic.invalid")).rejects.toThrow(/different network/);
  expect(fetchImpl).not.toHaveBeenCalled(); expect(fs.readFileSync(file)).toEqual(original); expect(fs.readFileSync(fundingFile)).toEqual(originalFunding);
});
it("accepts old originals only in their testnet configuration without relabelling", async () => {
  selected("arcTestnet"); const payment = await import("./local-payment.mts"), funding = await import("./local-funding.mts");
  expect(payment.readPending(journal(legacyPayment))).toEqual(legacyPayment); expect(funding.readFunding(journal(legacyFunding))).toEqual(legacyFunding);
});
it("binds mainnet payment recovery to original origin and never sends a paid POST", async () => {
  selected("arc"); const payment = await import("./local-payment.mts");
  const original = { ...legacyPayment, schema: "keryx-mcp-payment-v2", network: "eip155:5042", origin: "https://example.test" };
  const file = journal(original), fetchImpl = vi.fn().mockResolvedValue(Response.json({ status: "completed", queryId: original.queryId, answer: "synthetic" }));
  await expect(payment.recoverResearch("https://foreign.test", file, fetchImpl)).rejects.toThrow(/origin/);
  expect(fetchImpl).not.toHaveBeenCalled(); expect(payment.readPending(file)).toEqual(original);
  await payment.recoverResearch("https://example.test", file, fetchImpl);
  expect(fetchImpl).toHaveBeenCalledOnce(); expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty("method", "POST");
});
it("refuses wrong-network v2 journals without altering them", async () => {
  selected("arcTestnet"); const payment = await import("./local-payment.mts"), funding = await import("./local-funding.mts");
  expect(() => payment.readPending(journal({ ...legacyPayment, schema: "keryx-mcp-payment-v2", network: "eip155:5042", origin: "https://example.test" }))).toThrow(/different network/);
  expect(() => funding.readFunding(journal({ ...legacyFunding, schema: "keryx-mcp-funding-v2", network: "eip155:5042" }))).toThrow(/different network/);
});
it("delayed recovery preserves a replacement origin even with the same authorization identity", async () => {
  selected("arc"); const payment = await import("./local-payment.mts");
  const original = { ...legacyPayment, schema: "keryx-mcp-payment-v2", network: "eip155:5042", origin: "https://example.test" };
  const file = journal(original), replacement = { ...original, origin: "https://replacement.test" };
  const fetchImpl = vi.fn().mockImplementation(async () => {
    fs.writeFileSync(file, JSON.stringify(replacement));
    return Response.json({ status: "completed", queryId: original.queryId });
  });
  await payment.recoverResearch("https://example.test", file, fetchImpl);
  expect(payment.readPending(file)).toEqual(replacement);
});

it("refuses plaintext or credentialed mainnet transport before purchase or recovery I/O", async () => {
  selected("arc"); const policy = await import("./network-policy.mts"), payment = await import("./local-payment.mts");
  const original = { ...legacyPayment, schema: "keryx-mcp-payment-v2", network: "eip155:5042", origin: "https://example.test" };
  const file = journal(original), bytes = fs.readFileSync(file), fetchImpl = vi.fn();
  for (const url of ["http://example.test", "http://localhost:3939", "https://user:password@example.test", "https://example.test/#fragment"]) {
    expect(() => policy.assertCallerTransport(url)).toThrow(/HTTPS/);
    await expect(payment.recoverResearch(url, file, fetchImpl)).rejects.toThrow(/HTTPS/);
    await expect(payment.payForResearch({ url, body: { question: "private" }, account: {} as never,
      expectedPayee: `0x${"1".repeat(40)}`, expectedAmountMicros: "1", journalFile: file,
      maxAmountUsdc: 1, fetchImpl })).rejects.toThrow(/HTTPS/);
  }
  expect(fetchImpl).not.toHaveBeenCalled(); expect(fs.readFileSync(file)).toEqual(bytes);
  expect(fs.existsSync(`${file}.lock`)).toBe(false);
  expect(() => payment.readPending(journal({ ...original, origin: "http://example.test" }))).toThrow(/journal unavailable/);
  selected("arcTestnet"); const testnet = await import("./network-policy.mts");
  expect(testnet.assertCallerTransport("http://localhost:3939")).toBe("http://localhost:3939");
});
