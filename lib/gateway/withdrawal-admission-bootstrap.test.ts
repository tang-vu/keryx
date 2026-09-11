import { afterEach, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { createWithdrawalRuntimeAdmission } from "./withdrawal-admission-bootstrap";

const linux = it.skipIf(process.platform !== "linux"), directories: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "keryx-admission-bootstrap-")); directories.push(directory); chmodSync(directory, 0o700);
  const key = generatePrivateKey(), address = privateKeyToAccount(key).address;
  const policy = { format: "creator-mint-journal-v1" as const, chainId: 5042002 as const, relayer: address,
    initialNonce: 0, lifetimeGasBudgetWei: "600000000000000", maxSlots: 1 };
  writeFileSync(join(directory, "policy.json"), JSON.stringify(policy), { mode: 0o600 });
  writeFileSync(join(directory, "mint.sqlite"), "", { mode: 0o600 });
  const db = new DatabaseSync(join(directory, "mint.sqlite")); createWithdrawalMintJournal(db, policy, { initialize: true }); db.close();
  const env = { KERYX_WITHDRAWAL_RELAY_ENABLED: "1", KERYX_WITHDRAWAL_RELAY_ISOLATED: "1",
    KERYX_WITHDRAWAL_RELAY_DIRECTORY: directory, KERYX_WITHDRAWAL_RELAY_PRIVATE_KEY: key,
    KERYX_WITHDRAWAL_RELAY_ADDRESS: address, AGENT_FUNDER_PRIVATE_KEY: generatePrivateKey() };
  return { directory, policy, env };
}

it("denies disabled or invalid runtime before filesystem/RPC use", async () => {
  const f = await creatorWithdrawalFixture(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const env of [{}, { KERYX_WITHDRAWAL_RELAY_ENABLED: "1" }]) {
    await expect(createWithdrawalRuntimeAdmission(env, "eip155:5042002", "https://rpc.invalid", "1")
      (f.record, new AbortController().signal)).rejects.toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
});

linux("opens protected history, observes native backing and retains an idempotent hold after reopen", async () => {
  const f = fixture(), { record } = await creatorWithdrawalFixture();
  const timestamp = toHex(Math.floor(Date.now() / 1000));
  const fetcher = vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body);
    const result = request.method === "eth_chainId" ? toHex(5042002) : request.method === "eth_getBalance" ? toHex(BigInt("600000000000000"))
      : request.method === "eth_getBlockByNumber" ? { number: "0x2710", hash: `0x${"ab".repeat(32)}`,
        timestamp, transactions: [] } : undefined;
    if (result === undefined) throw new Error("Unexpected RPC operation");
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  });
  vi.stubGlobal("fetch", fetcher);
  const admit = createWithdrawalRuntimeAdmission(f.env, "eip155:5042002", "https://rpc.synthetic.invalid", f.policy.lifetimeGasBudgetWei);
  f.env.KERYX_WITHDRAWAL_RELAY_ENABLED = "0"; // Bootstrap snapshots server configuration.
  await admit(record, new AbortController().signal); await admit(record, new AbortController().signal);
  const db = new DatabaseSync(join(f.directory, "mint.sqlite"));
  try {
    const journal = createWithdrawalMintJournal(db, f.policy);
    expect(await journal.getGasAdmission(record.id)).toMatchObject({ request: record });
    expect(journal.gasAdmissionSummary().committedRequests).toBe(1);
    expect(journal.listRequestIds()).toEqual([]);
  } finally { db.close(); }
  expect(fetcher).toHaveBeenCalledTimes(10);
  expect(existsSync(join(f.directory, "private-worker.lock"))).toBe(false);
});

linux("rejects key/policy mismatch and missing history without RPC or initializing a replacement", async () => {
  const f = fixture(), { record } = await creatorWithdrawalFixture(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const invoke = () => createWithdrawalRuntimeAdmission(f.env, "eip155:5042002", "https://rpc.invalid", "1")(record, new AbortController().signal);
  writeFileSync(join(f.directory, "policy.json"), JSON.stringify({ ...f.policy, relayer: privateKeyToAccount(generatePrivateKey()).address }));
  await expect(invoke()).rejects.toThrow("policy mismatch");
  rmSync(join(f.directory, "mint.sqlite"));
  await expect(invoke()).rejects.toThrow();
  expect(existsSync(join(f.directory, "mint.sqlite"))).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});
