import { afterEach, expect, it } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync, rmSync, symlinkSync, unlinkSync, existsSync, linkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { inspectWithdrawalRelayFiles } from "./withdrawal-relay-files";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { CREATOR_WITHDRAWAL_REQUESTS_SQL, reserveSqliteWithdrawalRequest, claimSqliteWithdrawalTransfer } from "../db/creator-withdrawal-requests";
import { CREATOR_WITHDRAWAL_ATTESTATIONS_SQL, saveSqliteWithdrawalAttestation } from "../db/creator-withdrawal-attestations";
import { readFileSync } from "node:fs";
import { withWithdrawalApplicationStore } from "./withdrawal-application-store";
import { createWithdrawalMintReader } from "./withdrawal-mint-reader";

const linux = it.skipIf(process.platform !== "linux"), directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "keryx-relay-files-")); directories.push(directory); chmodSync(directory, 0o700);
  const key = generatePrivateKey(), address = privateKeyToAccount(key).address;
  const policy = { format: "creator-mint-journal-v1" as const, chainId: 5042002 as const, relayer: address,
    initialNonce: 0, lifetimeGasBudgetWei: "600000000000000", maxSlots: 1 };
  writeFileSync(join(directory, "policy.json"), JSON.stringify(policy), { mode: 0o600 });
  writeFileSync(join(directory, "mint.sqlite"), "", { mode: 0o600 });
  const db = new DatabaseSync(join(directory, "mint.sqlite")); createWithdrawalMintJournal(db, policy, { initialize: true }); db.close();
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const name of ["PATH", "ESBUILD_BINARY_PATH"]) if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, { KERYX_WITHDRAWAL_RELAY_ENABLED: "1", KERYX_WITHDRAWAL_RELAY_ISOLATED: "1",
    KERYX_WITHDRAWAL_RELAY_DIRECTORY: directory, KERYX_WITHDRAWAL_RELAY_PRIVATE_KEY: key,
    KERYX_WITHDRAWAL_RELAY_ADDRESS: address, AGENT_FUNDER_PRIVATE_KEY: generatePrivateKey(), KERYX_RPC_URL: "https://rpc.synthetic.invalid" });
  return { directory, policy, env };
}
linux("accepts the protected owner-only journal and bounded policy", async () => {
  const f = fixture(); expect(await inspectWithdrawalRelayFiles(f.directory)).toMatchObject({ directory: f.directory, policy: f.policy });
});

linux("reads owner mint progress without keys, writes or initializing missing history", async () => {
  const f = fixture(), { record } = await creatorWithdrawalFixture(), path = join(f.directory, "mint.sqlite");
  const before = readFileSync(path), read = createWithdrawalMintReader(f.directory);
  expect(await read(record, record.owner, new AbortController().signal)).toMatchObject({ mintStatus: "not-queued", chainFinalityVerified: false });
  expect(readFileSync(path)).toEqual(before);
  await expect(read(record, `0x${"00".repeat(20)}`, new AbortController().signal)).rejects.toThrow();
  rmSync(path); await expect(read(record, record.owner, new AbortController().signal)).rejects.toThrow();
  expect(existsSync(path)).toBe(false);
});
linux("refuses public permissions, symlinks, hard links and unsafe sidecars", async () => {
  const f = fixture(), path = join(f.directory, "mint.sqlite");
  chmodSync(path, 0o644); await expect(inspectWithdrawalRelayFiles(f.directory)).rejects.toThrow("files unavailable"); chmodSync(path, 0o600);
  linkSync(path, join(f.directory, "alias.sqlite")); await expect(inspectWithdrawalRelayFiles(f.directory)).rejects.toThrow("files unavailable"); unlinkSync(join(f.directory, "alias.sqlite"));
  symlinkSync(path, path + "-wal"); await expect(inspectWithdrawalRelayFiles(f.directory)).rejects.toThrow("files unavailable"); unlinkSync(path + "-wal");
  symlinkSync(f.directory, join(f.directory, "alias")); await expect(inspectWithdrawalRelayFiles(join(f.directory, "alias"))).rejects.toThrow("files unavailable");
  chmodSync(f.directory, 0o755); await expect(inspectWithdrawalRelayFiles(f.directory)).rejects.toThrow("files unavailable");
});
linux("does not leak malformed/oversized policy contents", async () => {
  const f = fixture(); writeFileSync(join(f.directory, "policy.json"), "private marker".repeat(400));
  await expect(inspectWithdrawalRelayFiles(f.directory)).rejects.toThrow(/^Protected withdrawal relay files unavailable$/);
});
linux("refuses a private journal below a replaceable non-sticky ancestor", async () => {
  const f = fixture(), parent = mkdtempSync(join(tmpdir(), "keryx-relay-parent-")); directories.push(parent);
  chmodSync(parent, 0o777); const nested = join(parent, "relay"); renameSync(f.directory, nested);
  await expect(inspectWithdrawalRelayFiles(nested)).rejects.toThrow("files unavailable");
});
linux("runs the actual CLI for inspection, schema check and an empty relay pass without network", async () => {
  const f = fixture(), execute = promisify(execFile);
  const invoke = async (...args: string[]) => execute(process.execPath, ["--import", "tsx", "scripts/withdrawal-relay.mts", ...args], { env: f.env, timeout: 25000 });
  expect(JSON.parse((await invoke()).stdout)).toMatchObject({ status: "inspected", slots: 0, prepared: 0, observed: 0,
    gasAdmission: { committedRequests: 0, awaitingSlot: 0, committedGasWei: "0", remainingGasBudgetWei: f.policy.lifetimeGasBudgetWei } });
  expect(JSON.parse((await invoke("--upgrade")).stdout)).toMatchObject({ status: "schema-checked" });
  expect(JSON.parse((await invoke("--run")).stdout)).toMatchObject({ state: "idle", signed: 0, broadcastAttempts: 0 });
  writeFileSync(join(f.directory, "private-worker.lock"), "retained synthetic crash lock", { mode: 0o600 });
  await expect(invoke()).rejects.toThrow("private details omitted");
  expect(existsSync(join(f.directory, "private-worker.lock"))).toBe(true);
}, 90000);

it("keeps CLI help free of runtime configuration", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/withdrawal-relay.mts", "--help"], { timeout: 25000 });
  expect(stdout).toContain("Default: inspect"); expect(stdout).toContain("never creates a wallet/journal");
});

linux("queues an existing application attestation through the real CLI without changing the application database", async () => {
  const f = fixture(), original = await creatorWithdrawalFixture(), path = join(f.directory, "app.sqlite");
  const app = new DatabaseSync(path); chmodSync(path, 0o600);
  try {
    app.exec(CREATOR_WITHDRAWAL_REQUESTS_SQL + CREATOR_WITHDRAWAL_ATTESTATIONS_SQL);
    await reserveSqliteWithdrawalRequest(app, original.record);
    const claim = (await claimSqliteWithdrawalTransfer(app, original.record.id, original.record.owner))!;
    await saveSqliteWithdrawalAttestation(app, original.record.id, original.record.owner, claim.claimId, original.response);
  } finally { app.close(); }
  const mint = new DatabaseSync(join(f.directory, "mint.sqlite"));
  try { await createWithdrawalMintJournal(mint, f.policy).admitGas(original.record, f.policy.lifetimeGasBudgetWei, new AbortController().signal); }
  finally { mint.close(); }
  const before = readFileSync(path), execute = promisify(execFile);
  const invoke = (...extra: string[]) => execute(process.execPath, ["--import", "tsx", "scripts/withdrawal-relay.mts", "--queue",
    "--application-db", path, "--gas", "300000", "--max-fee-per-gas", "2000000000",
    "--priority-fee-per-gas", "1000000000", "--gas-budget-wei", "600000000000000", ...extra], { env: f.env, timeout: 30000 });
  expect(JSON.parse((await invoke()).stdout)).toMatchObject({ state: "scanned", attached: 1, unavailable: 0 });
  expect(JSON.parse((await invoke()).stdout)).toMatchObject({ attached: 0, scanned: 0 });
  await expect(invoke("--run")).rejects.toThrow("private details omitted");
  await expect(invoke("--limit", "65")).rejects.toThrow("private details omitted");
  await withWithdrawalApplicationStore(path, async store => {
    expect(await store.getCreatorWithdrawalAttestation(original.record.id, `0x${"00".repeat(20)}`)).toBeNull();
  });
  expect(readFileSync(path)).toEqual(before);
  const reopened = new DatabaseSync(join(f.directory, "mint.sqlite"));
  try {
    const journal = createWithdrawalMintJournal(reopened, f.policy);
    expect((await journal.getSlot(original.record.id))?.terms.nonce).toBe(0);
    expect(await journal.getPrepared(original.record.id)).toBeNull();
  } finally { reopened.close(); }
}, 90000);

linux("rejects missing, permissive and unrelated application stores without creating or migrating them", async () => {
  const f = fixture(), missing = join(f.directory, "missing.sqlite"), callback = async () => null;
  await expect(withWithdrawalApplicationStore(missing, callback)).rejects.toThrow("database unavailable");
  expect(existsSync(missing)).toBe(false);
  const wrong = join(f.directory, "wrong.sqlite"), db = new DatabaseSync(wrong); db.exec("CREATE TABLE unrelated(id INTEGER)"); db.close();
  chmodSync(wrong, 0o600); const before = readFileSync(wrong);
  await expect(withWithdrawalApplicationStore(wrong, callback)).rejects.toThrow();
  expect(readFileSync(wrong)).toEqual(before);
  chmodSync(wrong, 0o644);
  await expect(withWithdrawalApplicationStore(wrong, callback)).rejects.toThrow("database unavailable");
});
