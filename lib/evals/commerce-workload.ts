/** Synthetic workload support. No production datastore, custody, provider, or signer. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { PaymentRecord } from "../types";
import type { A2aOrder } from "../a2a/order";
import type { MonthlyPurchase } from "../db/research-monthly";

export const SYNTHETIC_PAYER = `0x${"1".repeat(40)}`;
export const SYNTHETIC_PAYEE = `0x${"2".repeat(40)}`;
export const SYNTHETIC_NETWORK = "eip155:5042002" as const;
export const ARTIFACT_ROOT = path.resolve(".artifacts/workload-commerce");
let fallbackDirectory: string | undefined;

/** Children inherit only OS process plumbing, never application credentials or NODE_OPTIONS. */
export function commerceEnvironment(directory: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "COMSPEC", "PATHEXT"])
    if (process.env[key]) env[key] = process.env[key];
  return { ...env, KERYX_COMMERCE_ARTIFACT_DIR: directory, KERYX_FORCE_OFFLINE: "1",
    KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
    KERYX_EXTERNAL_DISCOVERY: "0", KERYX_REGISTRY_ADDRESS: "", NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: "",
    NODE_ENV: "test", NO_COLOR: "1" };
}

export function commerceDirectory(): string {
  const supplied = process.env.KERYX_COMMERCE_ARTIFACT_DIR;
  if (!supplied && !fallbackDirectory) {
    fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
    fallbackDirectory = fs.mkdtempSync(path.join(ARTIFACT_ROOT, "tests-"));
  }
  const directory = supplied ? path.resolve(supplied) : fallbackDirectory!;
  const relative = path.relative(ARTIFACT_ROOT, directory);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Synthetic artifacts must be a child of workload-commerce");
  fs.mkdirSync(directory, { recursive: true });
  assert.equal(fs.realpathSync(directory), directory, "Synthetic artifact path must not redirect through a symlink");
  return directory;
}

export function writeCommerceArtifact(name: string, value: unknown): string {
  assert(/^[a-zA-Z0-9.-]+$/.test(name));
  const target = path.join(commerceDirectory(), name);
  fs.writeFileSync(target, JSON.stringify({ evidenceKind: "isolated-synthetic-acceptance", liveSettlement: false, value }, null, 2) + "\n");
  return target;
}

export function pendingOriginal(): PaymentRecord {
  return { id: `x402:${"a".repeat(64)}`, kind: "fetch", queryId: "R21-original-task", sourceId: "R21-source",
    sourceName: "Synthetic publisher", payer: SYNTHETIC_PAYER, payee: SYNTHETIC_PAYEE, amountUsdc: 0.004001,
    network: SYNTHETIC_NETWORK, settled: false, settlementStatus: "pending", authorizationId: `0x${"a".repeat(64)}`,
    authorizationExpiresAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
    itemId: "R21-article", contentVersion: "sha256:R21-retained-version" };
}

/** Executed by a genuinely new Node process. Network is blocked before runtime imports. */
export async function recoverCommerceOriginal(): Promise<void> {
  globalThis.fetch = async () => { throw new Error("Synthetic recovery forbids network"); };
  const { SqliteAdapter } = await import("../db/sqlite-adapter");
  const { reconcilePendingPayments } = await import("../gateway/x402-transfer-reconciliation");
  const db = new SqliteAdapter(path.join(commerceDirectory(), "R21.sqlite"));
  await db.init();
  try {
    const original = pendingOriginal();
    const before = await db.listPendingPayments(10);
    assert.equal(before.length, 1);
    assert.equal(before[0].authorizationId, original.authorizationId);
    const empty = await reconcilePendingPayments(db, { search: async () => [] });
    assert.equal(empty.awaiting, 1);
    assert.equal(empty.expiredAwaiting, 1);
    const transfer = { id: "synthetic-circle-original", status: "completed" as const, token: "USDC",
      sendingNetwork: original.network, recipientNetwork: original.network, fromAddress: original.payer,
      toAddress: original.payee, amount: "4001", nonce: original.authorizationId!, txHash: null,
      createdAt: original.createdAt, updatedAt: original.createdAt };
    const mismatched = await reconcilePendingPayments(db, { search: async () => [{ ...transfer, toAddress: SYNTHETIC_PAYER }] });
    assert.equal(mismatched.mismatched, 1);
    assert.equal((await db.listPendingPayments(10)).length, 1);
    const exact = await reconcilePendingPayments(db, { search: async () => [transfer] });
    assert.equal(exact.promoted, 1);
    const after = await db.listPayments(10);
    assert.equal(after.length, 1);
    assert.equal(after[0].authorizationId, original.authorizationId);
    assert.equal(after[0].settlementStatus, "settled");
    const secondRead = await reconcilePendingPayments(db, { search: async () => { throw new Error("Resolved original must not be searched again"); } });
    assert.equal(secondRead.scanned, 0);
    writeCommerceArtifact("R21-recovery.json", { childPid: process.pid, original, before, empty, mismatched, exact, after,
      submissionCallsDuringRecovery: 0, secondRead, settlementAuthority: "injected synthetic terminal evidence, not Circle" });
  } finally { db.close(); }
}

export async function monthlyFixture(): Promise<{ purchase: MonthlyPurchase; order: A2aOrder; requestId: string }> {
  const { monthlyPurchaseId, monthlyOrderId, MONTHLY_TERM_MS } = await import("../db/research-monthly");
  const { a2aResearchPackage } = await import("../a2a/research-package");
  const { a2aRequestHash } = await import("../a2a/order");
  const createdAt = "2026-10-01T00:00:00.000Z";
  const identity = { network: SYNTHETIC_NETWORK, payer: SYNTHETIC_PAYER, payee: SYNTHETIC_PAYEE, authorizationId: "R23-synthetic-original" };
  const purchase: MonthlyPurchase = { payer: identity.payer, payee: identity.payee, authorizationId: identity.authorizationId,
    id: monthlyPurchaseId(identity), transaction: "synthetic-R23-settlement",
    quoteId: "a".repeat(64), createdAt, expiresAt: new Date(Date.parse(createdAt) + MONTHLY_TERM_MS).toISOString(),
    creatorBudgetMicros: 50000, serviceFeeMicros: 180000, totalMicros: 380000, researchPackage: a2aResearchPackage("deep") };
  const requestId = "R23-identical-request";
  const id = monthlyOrderId(purchase.id, requestId);
  const question = "Synthetic interruption recovery: retain this exact task.";
  const value = { id, queryId: id, authorizationId: `${purchase.authorizationId}:monthly:${requestId}`,
    payer: purchase.payer, payee: purchase.payee, amountUsdc: purchase.totalMicros / 4 / 1e6,
    creatorBudgetUsdc: purchase.creatorBudgetMicros / 1e6, serviceFeeUsdc: purchase.serviceFeeMicros / 4 / 1e6,
    researchMode: purchase.researchPackage.researchMode, researchPackage: purchase.researchPackage, status: "running" as const,
    transaction: purchase.transaction, request: { question, origin: "a2a" as const, monthlyId: purchase.id },
    startedAt: null, workerId: null, executionJournalVersion: 1 as const, paymentStartedAt: null, resultSavingAt: null,
    response: null, errorCode: null, resolution: null, createdAt, updatedAt: createdAt };
  return { purchase, requestId, order: { ...value, requestHash: a2aRequestHash({ ...value, question }) } };
}
