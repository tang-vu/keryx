import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPrivateAuthorization } from "../buyer/private-request-commitment";
import { BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC, buyerTypedData } from "../buyer/protocol";
import { preparePrivateResearchIntent } from "../a2a/private-research-intent";
import { SqliteAdapter } from "./sqlite-adapter";
import { getSupabasePrivateResearchIntent, reserveSupabasePrivateResearchIntent } from "./private-research-intents";
import { claimSupabasePrivatePayment, confirmSupabasePrivatePayment } from "./private-research-payments";
import type { PrivatePaymentConfirmation } from "../a2a/private-payment-state";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-private-intents-"));
const file = path.join(directory, "test.sqlite");
const db = new SqliteAdapter(file), other = new SqliteAdapter(file);
await db.init(); await other.init();
const raw = new DatabaseSync(file);
afterAll(() => {
  db.close(); other.close(); raw.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
  fs.rmdirSync(directory);
});

// Ephemeral EOA is never funded or sent to a network. Only synthetic intent data is persisted.
const account = privateKeyToAccount(generatePrivateKey());
const merchants = { privatePayee: `0x${"ab".repeat(20)}`, publicResearchPayee: `0x${"cd".repeat(20)}` };
const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: merchants.privatePayee, maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
const request = { question: "Synthetic private research storage marker", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async", access: "payer-private-v1", model: null };
const fresh = await createPrivateAuthorization(request, requirement, account.address, merchants, 1788912000000);
const signature = await account.signTypedData(buyerTypedData(fresh.authorization));
const submission = { request: fresh.request, salt: fresh.salt, payment: { authorization: fresh.authorization, signature } };
const intent = await preparePrivateResearchIntent(submission, requirement, merchants);

it("atomically retains one immutable original across two connections and repeated reservations", async () => {
  const results = await Promise.all([db.reservePrivateResearchIntent(intent), other.reservePrivateResearchIntent(intent)]);
  expect(results).toEqual([intent, intent]);
  expect(raw.prepare("SELECT count(*) AS n FROM private_research_intents WHERE id = ?").get(intent.id)?.n).toBe(1);
  expect(await db.reservePrivateResearchIntent(intent)).toEqual(intent);
  expect(() => raw.prepare("UPDATE private_research_intents SET payer = ? WHERE id = ?").run(merchants.privatePayee, intent.id)).toThrow("immutable");
});

it("scopes reads to the payer and keeps reservations out of public runs and paid orders", async () => {
  await db.reservePrivateResearchIntent(intent);
  expect(await db.getPrivateResearchIntent(intent.id, account.address)).toEqual(intent);
  expect(await db.getPrivateResearchIntent(intent.id, merchants.privatePayee)).toBeNull();
  expect(await db.getPrivateResearchIntent(`prv_${"0".repeat(64)}`, account.address)).toBeNull();
  await expect(db.getPrivateResearchIntent(intent.id, "")).rejects.toThrow();
  expect(await db.getQueryRun(intent.id)).toBeNull();
  expect(await db.getA2aOrder(intent.id)).toBeNull();
  expect(await db.listRecentQueries(10)).toEqual([]);
  for (const table of ["query_runs", "a2a_orders", "payment_events"]) {
    expect(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
  }
});

it("refuses a changed policy for the same signed identity without replacing the first row", async () => {
  await db.reservePrivateResearchIntent(intent);
  const changed = await preparePrivateResearchIntent(submission, requirement, { ...merchants, publicResearchPayee: `0x${"ef".repeat(20)}` });
  expect(changed.id).toBe(intent.id);
  await expect(other.reservePrivateResearchIntent(changed)).rejects.toThrow("reservation conflict");
  expect(await db.getPrivateResearchIntent(intent.id, account.address)).toEqual(intent);
});

it("rejects unverified input and corrupted stored identities without exposing parser details", async () => {
  const changed = { ...intent, submission: { ...intent.submission, request: { ...intent.submission.request, question: "Altered" } } };
  await expect(db.reservePrivateResearchIntent(changed)).rejects.toThrow("Invalid stored private research intent");
  const forgedId = `prv_${"1".repeat(64)}`;
  raw.prepare("INSERT INTO private_research_intents(id,payer,data) VALUES (?,?,?)").run(forgedId, account.address.toLowerCase(), JSON.stringify(intent));
  await expect(db.getPrivateResearchIntent(forgedId, account.address)).rejects.toThrow("owner mismatch");
  const badId = `prv_${"2".repeat(64)}`;
  raw.prepare("INSERT INTO private_research_intents(id,payer,data) VALUES (?,?,?)").run(badId, account.address.toLowerCase(), "not-json");
  await expect(db.getPrivateResearchIntent(badId, account.address)).rejects.toThrow("Invalid stored private research intent");
});

it("recovers the exact saved request, salt, authorization and quote after reopening storage", async () => {
  await db.reservePrivateResearchIntent(intent);
  const reopened = new SqliteAdapter(file);
  try {
    await reopened.init();
    expect(await reopened.getPrivateResearchIntent(intent.id, account.address)).toEqual(intent);
  } finally { reopened.close(); }
});

it("copies trusted quote inputs before awaiting cryptographic verification", async () => {
  const mutable = structuredClone(requirement);
  const pending = preparePrivateResearchIntent(submission, mutable, merchants);
  mutable.amount = "60000";
  expect((await pending).requirement.amount).toBe("50000");
});

it("Supabase SDK binds owner reads, ignores duplicate inserts and confirms the original row", async () => {
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
    .mockResolvedValueOnce(Response.json([{ data: intent }]));
  const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
  expect(await reserveSupabasePrivateResearchIntent(client, intent)).toEqual(intent);
  const insertUrl = new URL(String(http.mock.calls[0][0]));
  expect(insertUrl.pathname).toBe("/rest/v1/private_research_intents");
  expect(insertUrl.searchParams.get("on_conflict")).toBe("id");
  const insert = http.mock.calls[0][1]!;
  expect(insert.method).toBe("POST");
  expect(new Headers(insert.headers).get("prefer")).toContain("resolution=ignore-duplicates");
  expect(JSON.parse(String(insert.body))).toEqual({ id: intent.id, payer: account.address.toLowerCase(), data: intent });
  const readUrl = new URL(String(http.mock.calls[1][0]));
  expect(readUrl.searchParams.get("id")).toBe(`eq.${intent.id}`);
  expect(readUrl.searchParams.get("payer")).toBe(`eq.${account.address.toLowerCase()}`);
  expect(http.mock.calls[1][1]?.method).toBe("GET");
});

it("Supabase outages and missing or foreign readbacks cannot claim a successful reservation", async () => {
  for (const replies of [
    [new Response("{}", { status: 503 })],
    [new Response(null, { status: 201 }), Response.json([])],
    [new Response(null, { status: 201 }), Response.json([{ data: { ...intent, id: `prv_${"3".repeat(64)}` } }])],
  ]) {
    const http = vi.fn<typeof fetch>();
    for (const reply of replies) http.mockResolvedValueOnce(reply);
    const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
    await expect(reserveSupabasePrivateResearchIntent(client, intent)).rejects.toThrow();
  }
  const http = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 503 }));
  const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
  await expect(getSupabasePrivateResearchIntent(client, intent.id, account.address)).rejects.toThrow("storage unavailable");
});

// Synthetic confirmation fixtures exercise storage, not real Circle settlement.
const confirmation: PrivatePaymentConfirmation = {
  source: "circle-facilitator-success", transaction: "synthetic-transfer-reference",
  network: BUYER_NETWORK, payer: account.address, payee: merchants.privatePayee,
  amountMicros: requirement.amount, authorizationId: fresh.authorization.nonce,
};

it("grants one durable submission claim across two connections and never reclaims after a restart", async () => {
  await db.reservePrivateResearchIntent(intent);
  expect(await db.getPrivatePaymentState(intent.id, account.address)).toBeNull();
  const claims = await Promise.all([db.claimPrivatePaymentSubmission(intent.id, account.address), other.claimPrivatePaymentSubmission(intent.id, account.address)]);
  expect(claims.filter(result => result.claimed)).toHaveLength(1);
  expect(claims.every(result => result.state.status === "pending")).toBe(true);
  const reopened = new SqliteAdapter(file);
  vi.useFakeTimers(); vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
  try {
    await reopened.init();
    expect(await reopened.claimPrivatePaymentSubmission(intent.id, account.address)).toMatchObject({ claimed: false, state: { status: "pending", confirmation: null } });
  } finally { vi.useRealTimers(); reopened.close(); }
});

it("rejects another payer and mismatched confirmation tuples without promoting pending state", async () => {
  expect(await db.getPrivatePaymentState(intent.id, merchants.privatePayee)).toBeNull();
  await expect(db.claimPrivatePaymentSubmission(intent.id, merchants.privatePayee)).rejects.toThrow("intent unavailable");
  await expect(db.confirmPrivatePayment(intent.id, merchants.privatePayee, confirmation)).rejects.toThrow("intent unavailable");
  for (const altered of [
    { ...confirmation, payer: merchants.privatePayee }, { ...confirmation, payee: merchants.publicResearchPayee },
    { ...confirmation, amountMicros: "60000" }, { ...confirmation, authorizationId: `0x${"4".repeat(64)}` },
    { ...confirmation, transaction: "" }, { ...confirmation, network: "eip155:1" },
  ]) await expect(db.confirmPrivatePayment(intent.id, account.address, altered as PrivatePaymentConfirmation)).rejects.toThrow("confirmation mismatch");
  expect(await db.getPrivatePaymentState(intent.id, account.address)).toMatchObject({ status: "pending" });
});

it("retains one confirmed reference, acknowledges exact retries and rejects conflicting references", async () => {
  const settled = await db.confirmPrivatePayment(intent.id, account.address, confirmation);
  expect(settled).toMatchObject({ status: "settled", confirmation: { transaction: confirmation.transaction, payer: account.address.toLowerCase() } });
  expect(await other.confirmPrivatePayment(intent.id, account.address, confirmation)).toEqual(settled);
  await expect(other.confirmPrivatePayment(intent.id, account.address, { ...confirmation, transaction: "another-reference" })).rejects.toThrow("confirmation conflict");
  expect(await db.claimPrivatePaymentSubmission(intent.id, account.address)).toEqual({ claimed: false, state: settled });
});

it("cannot confirm a reservation that never crossed the durable submission boundary", async () => {
  const next = await createPrivateAuthorization(request, requirement, account.address, merchants, 1788912000000);
  const nextSignature = await account.signTypedData(buyerTypedData(next.authorization));
  const nextIntent = await preparePrivateResearchIntent({ request: next.request, salt: next.salt, payment: { authorization: next.authorization, signature: nextSignature } }, requirement, merchants);
  await db.reservePrivateResearchIntent(nextIntent);
  await expect(db.confirmPrivatePayment(nextIntent.id, account.address, { ...confirmation, authorizationId: next.authorization.nonce })).rejects.toThrow("confirmation conflict");
  expect(await db.getPrivatePaymentState(nextIntent.id, account.address)).toBeNull();
});

it("Supabase claims through the restricted RPC and requires valid readback before authorizing submission", async () => {
  const pending = { started_at: "2026-09-09T00:00:00.000Z", confirmation: null, settled_at: null };
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(Response.json(true))
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(Response.json([pending]));
  const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
  expect(await claimSupabasePrivatePayment(client, intent.id, account.address)).toMatchObject({ claimed: true, state: { status: "pending" } });
  expect(String(http.mock.calls[1][0])).toContain("/rpc/claim_private_research_payment");
  expect(JSON.parse(String(http.mock.calls[1][1]?.body))).toEqual({ p_id: intent.id, p_payer: account.address.toLowerCase() });
  const broken = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(Response.json(true))
    .mockResolvedValueOnce(new Response("{}", { status: 503 }));
  const unavailable = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: broken }, auth: { persistSession: false } });
  await expect(claimSupabasePrivatePayment(unavailable, intent.id, account.address)).rejects.toThrow();
});

it("Supabase does not report confirmation from an RPC success without confirmed readback", async () => {
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(Response.json([{ started_at: "2026-09-09T00:00:00.000Z", confirmation: null, settled_at: null }]));
  const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
  await expect(confirmSupabasePrivatePayment(client, intent.id, account.address, confirmation)).rejects.toThrow("confirmation conflict");
  expect(String(http.mock.calls[1][0])).toContain("/rpc/confirm_private_research_payment");
});

it("a newly inserted claim cannot authorize submission if readback already shows settlement", async () => {
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(Response.json(true))
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(Response.json([{ started_at: "2026-09-09T00:00:00.000Z", confirmation,
      settled_at: "2026-09-09T00:00:01.000Z" }]));
  const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
  expect(await claimSupabasePrivatePayment(client, intent.id, account.address)).toMatchObject({ claimed: false, state: { status: "settled" } });
});
