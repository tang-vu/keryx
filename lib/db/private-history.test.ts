import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterAll, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SqliteAdapter } from "./sqlite-adapter";
import { createPrivateAuthorization } from "../buyer/private-request-commitment";
import { BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC, buyerTypedData } from "../buyer/protocol";
import { preparePrivateResearchIntent } from "../a2a/private-research-intent";
import { listSupabasePrivateResearchHistory } from "./private-research-intents";
import { privateHistoryPage } from "../a2a/private-history";

const directory = mkdtempSync(join(tmpdir(), "keryx-private-history-")), file = join(directory, "db.sqlite");
const db = new SqliteAdapter(file); await db.init();
const raw = new DatabaseSync(file);
afterAll(() => { db.close(); raw.close(); for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true }); rmdirSync(directory); });
const owner = privateKeyToAccount(generatePrivateKey()), foreign = privateKeyToAccount(generatePrivateKey());
const merchants = { privatePayee: `0x${"ab".repeat(20)}`, publicResearchPayee: `0x${"cd".repeat(20)}` };
const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: merchants.privatePayee,
  maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
const request = { question: "Synthetic private history", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async", access: "payer-private-v1", model: null };
async function insert(account: typeof owner, createdAt = "2026-09-09T00:00:00.000Z") {
  // Only ephemeral unfunded signatures and disposable local storage.
  const fresh = await createPrivateAuthorization(request, requirement, account.address, merchants, 1788912000000);
  const signature = await account.signTypedData(buyerTypedData(fresh.authorization));
  const intent = await preparePrivateResearchIntent({ request: fresh.request, salt: fresh.salt,
    payment: { authorization: fresh.authorization, signature } }, requirement, merchants);
  raw.prepare("INSERT INTO private_research_intents(id,payer,data,created_at) VALUES(?,?,?,?)").run(intent.id, account.address.toLowerCase(), JSON.stringify(intent), createdAt);
  return intent;
}

it("pages tied timestamps without lost or foreign jobs and excludes signed proof from owner history", async () => {
  const intents = [];
  for (let i = 0; i < 27; i++) intents.push(await insert(owner));
  const foreignIntent = await insert(foreign);
  const first = await privateHistoryPage(db, `0x${owner.address.slice(2).toUpperCase()}`);
  expect(first.jobs).toHaveLength(25); expect(first.nextCursor).not.toBeNull();
  await insert(owner, "2026-09-09T01:00:00.000Z");
  const second = await privateHistoryPage(db, owner.address, first.nextCursor!);
  expect(second.jobs).toHaveLength(2); expect(second.nextCursor).toBeNull();
  const all = [...first.jobs, ...second.jobs];
  expect(all.map(row => row.id)).toEqual(intents.map(row => row.id).sort().reverse());
  expect(all.some(row => row.id === foreignIntent.id)).toBe(false);
  expect(all.every(row => row.record === "private-intent")).toBe(true);
  const text = JSON.stringify(first);
  for (const intent of intents) for (const hidden of [intent.submission.salt, intent.submission.payment.signature,
    intent.submission.payment.authorization.nonce]) expect(text).not.toContain(hidden);
  const unknown = privateKeyToAccount(generatePrivateKey());
  expect(await privateHistoryPage(db, unknown.address)).toEqual({ format: "private-history-v1", jobs: [], nextCursor: null });
  expect((await privateHistoryPage(db, owner.address, { createdAt: "2026-09-09T00:00:00.000Z", id: foreignIntent.id })).jobs.every(row => row.id !== foreignIntent.id)).toBe(true);
});

it("constrains Supabase queries and rejects corrupt or foreign stored proof and malformed cursors", async () => {
  const intent = await insert(owner);
  const row = { id: intent.id, data: intent, created_at: "2026-09-09T00:00:00.123456+00:00" };
  const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json([row]));
  const client = createClient("https://synthetic.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
  const result = await listSupabasePrivateResearchHistory(client, owner.address, { id: intent.id, createdAt: row.created_at });
  expect(result).toEqual([{ intent, createdAt: row.created_at }]);
  const query = new URL(String(http.mock.calls[0][0])).searchParams;
  expect(query.get("payer")).toBe(`eq.${owner.address.toLowerCase()}`);
  expect(query.get("limit")).toBe("26"); expect(query.get("order")).toBe("created_at.desc,id.desc");
  expect(query.get("or")).toContain(`created_at.eq.${row.created_at},id.lt.${intent.id}`);
  http.mockResolvedValueOnce(Response.json([row]));
  await expect(listSupabasePrivateResearchHistory(client, foreign.address)).rejects.toThrow("owner mismatch");
  http.mockResolvedValueOnce(Response.json([{ ...row, data: { ...intent, id: `prv_${"f".repeat(64)}` } }]));
  await expect(listSupabasePrivateResearchHistory(client, owner.address)).rejects.toThrow("Invalid stored");
  const count = http.mock.calls.length;
  await expect(listSupabasePrivateResearchHistory(client, owner.address, { id: intent.id, createdAt: "now),payer.eq.foreign" })).rejects.toThrow();
  expect(http).toHaveBeenCalledTimes(count);
  http.mockResolvedValueOnce(new Response("{}", { status: 503 }));
  await expect(listSupabasePrivateResearchHistory(client, owner.address)).rejects.toThrow("history unavailable");
});
