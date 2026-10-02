import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PrivateKeyAccount } from "viem/accounts";
import { z } from "zod";
import { createPinnedArcBatchSigner } from "../lib/payments/pinned-arc-batch-signer.ts";
import { readBoundedJson } from "../lib/read-bounded-json.ts";
import { assertCallerJournalNetwork, assertCallerTransport, CallerJournalNetworkMismatch, callerProfile, callerConfig } from "./network-policy.mts";

const NETWORK = callerProfile.networkId;
const USDC = callerProfile.usdcAddress;
const GATEWAY = callerProfile.gatewayWallet;

export type PendingPayment = {
  schema?: "keryx-mcp-payment-v2";
  network?: "eip155:5042002" | "eip155:5042";
  origin?: string;
  queryId: string;
  authorizationId: string;
  amountUsdc: string;
  status: "submitted" | "settled" | "unconfirmed";
  settlementId?: string;
  paymentResponse?: string;
  httpStatus?: number;
};

export function readPending(file: string): PendingPayment | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8192) throw new Error();
    const record = z.object({ schema: z.literal("keryx-mcp-payment-v2").optional(), network: z.enum(["eip155:5042002", "eip155:5042"]).optional(),
      origin: z.string().url().optional(), queryId: z.string().regex(/^a2a_[0-9a-f]{64}$/), authorizationId: z.string().regex(/^0x[0-9a-f]{64}$/i),
      amountUsdc: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/), status: z.enum(["submitted", "settled", "unconfirmed"]),
      settlementId: z.string().min(1).max(256).optional(), paymentResponse: z.string().max(4096).optional(),
      httpStatus: z.number().int().min(100).max(599).optional() }).strict().parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (record.schema ? !record.network || !record.origin || new URL(record.origin).origin !== record.origin
      : record.network !== undefined || record.origin !== undefined) throw new Error();
    assertCallerJournalNetwork(record.network);
    if (record.origin) assertCallerTransport(record.origin);
    return record;
  }
  catch (error) {
    if (error instanceof CallerJournalNetworkMismatch) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Payment journal unavailable; preserve the original file for owner recovery");
  }
}

function savePending(file: string, payment: PendingPayment): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify(payment, null, 2)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
  syncParent(file);
}

function syncParent(file: string): void {
  if (process.platform === "win32") return; // Windows namespace/power-loss durability remains a host acceptance gate.
  const descriptor = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function createPending(file: string, payment: PendingPayment): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Exclusive creation prevents two concurrent MCP calls from submitting different authorizations.
  const descriptor = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify(payment, null, 2)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  syncParent(file);
}

export function clearPending(file: string): void {
  fs.rmSync(file, { force: true });
  syncParent(file);
}

function queryId(payer: string, payee: string, authorizationId: string): string {
  const identity = ["keryx-a2a-v2", NETWORK, payer.toLowerCase(), payee.toLowerCase(), authorizationId.toLowerCase()].join("|");
  return `a2a_${crypto.createHash("sha256").update(identity).digest("hex")}`;
}

type Requirements = {
  scheme: string; network: string; asset: string; amount: string; payTo: string;
  maxTimeoutSeconds: number; extra?: Record<string, unknown>;
};

export async function payForResearch<T>(input: {
  url: string; body: Record<string, unknown>; account: PrivateKeyAccount;
  expectedPayee: string; expectedAmountMicros: string;
  journalFile: string; maxAmountUsdc: number; rpcUrl?: string; fetchImpl?: typeof fetch;
}): Promise<{ data: T; settlementId: string; amountPaid: string }> {
  const origin = assertCallerTransport(input.url);
  fs.mkdirSync(path.dirname(input.journalFile), { recursive: true });
  const lock = `${input.journalFile}.lock`;
  try { fs.mkdirSync(lock); } catch { throw new Error("Payment admission is held; inspect the original journal and lock before another purchase"); }
  try {
  const prior = readPending(input.journalFile);
  if (prior) throw new Error(`A previous payment may have settled. Recover query ${prior.queryId} before paying again; journal: ${input.journalFile}`);
  if (!Number.isFinite(input.maxAmountUsdc) || input.maxAmountUsdc <= 0 || input.maxAmountUsdc > 1) throw new Error("Payment total limit must be at most 1 USDC");
  const request = JSON.stringify(input.body);
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = { "content-type": "application/json", accept: "application/json" };
  const challengeResponse = await fetchImpl(input.url, { method: "POST", headers, body: request, redirect: "error", signal: AbortSignal.timeout(30000) });
  if (challengeResponse.status !== 402) throw new Error(`Expected a 402 quote, received HTTP ${challengeResponse.status}`);
  const encoded = challengeResponse.headers.get("PAYMENT-REQUIRED");
  if (!encoded || encoded.length > 65536) throw new Error("402 quote omitted bounded PAYMENT-REQUIRED");
  const challenge = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
    x402Version: number; resource?: unknown; accepts?: Requirements[];
  };
  if (challenge.x402Version !== 2) throw new Error("Unsupported x402 version");
  const terms = challenge.accepts?.find((item) => item.network === NETWORK && item.scheme === "exact");
  if (!terms || terms.asset.toLowerCase() !== USDC.toLowerCase() || terms.extra?.name !== "GatewayWalletBatched"
    || terms.extra.version !== "1" || String(terms.extra.verifyingContract).toLowerCase() !== GATEWAY.toLowerCase()
    || !/^0x[0-9a-f]{40}$/i.test(terms.payTo) || !/^[1-9]\d*$/.test(terms.amount)) {
    throw new Error("Quote contains unsupported payment requirements");
  }
  const micros = BigInt(terms.amount);
  if (!/^0x[0-9a-f]{40}$/i.test(input.expectedPayee) || terms.payTo.toLowerCase() !== input.expectedPayee.toLowerCase()
    || !/^[1-9]\d{0,6}$/.test(input.expectedAmountMicros) || terms.amount !== input.expectedAmountMicros) {
    throw new Error("Quote does not match the independently reviewed seller and exact authorized fee plus creator budget");
  }
  if (micros > BigInt(Math.round(input.maxAmountUsdc * 1_000_000))) {
    throw new Error(`Quote ${Number(micros) / 1_000_000} USDC exceeds the permitted total ${input.maxAmountUsdc} USDC`);
  }
  if (terms.maxTimeoutSeconds !== callerConfig.maxTimeoutSeconds) throw new Error("Quote has an unexpected authorization lifetime");
  const signed = await createPinnedArcBatchSigner(input.account, input.rpcUrl ?? callerConfig.rpcUrl).createPaymentPayload(2,
    { ...terms, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: GATEWAY } });
  const authorization = (signed.payload as { authorization: { nonce: string } }).authorization;
  const payment: PendingPayment = {
    schema: "keryx-mcp-payment-v2", network: NETWORK, origin,
    queryId: queryId(input.account.address, terms.payTo, authorization.nonce),
    authorizationId: authorization.nonce,
    amountUsdc: (Number(micros) / 1_000_000).toString(), status: "submitted",
  };
  createPending(input.journalFile, payment);
  let paid: Response;
  try {
    const signature = Buffer.from(JSON.stringify({ ...signed, resource: challenge.resource ?? { url: input.url }, accepted: terms })).toString("base64");
    paid = await fetchImpl(input.url, { method: "POST", headers: { ...headers, "Payment-Signature": signature }, body: request,
      redirect: "error", signal: AbortSignal.timeout(30000) });
  } catch {
    savePending(input.journalFile, { ...payment, status: "unconfirmed" });
    throw new Error(`Payment outcome unknown for ${payment.queryId}; recover before paying again.`);
  }
  let settlementId: string | undefined;
  const paymentResponse = paid.headers.get("PAYMENT-RESPONSE");
  try {
    const receipt = JSON.parse(Buffer.from(paymentResponse ?? "", "base64").toString("utf8"));
    if (receipt.success === true && receipt.network === NETWORK && receipt.payer?.toLowerCase() === input.account.address.toLowerCase()
      && typeof receipt.transaction === "string" && receipt.transaction) settlementId = receipt.transaction;
  } catch { /* No trustworthy settlement confirmation. */ }
  const updated = { ...payment, status: settlementId ? "settled" as const : "unconfirmed" as const,
    ...(paymentResponse ? { paymentResponse } : {}), ...(settlementId ? { settlementId } : {}), httpStatus: paid.status };
  savePending(input.journalFile, updated);
  if (!settlementId || !paid.ok) {
    throw new Error(`${settlementId ? "Payment settled" : "Payment outcome unconfirmed"}; HTTP ${paid.status}; query ${payment.queryId}; settlement ${settlementId ?? "unknown"}. Recover before paying again.`);
  }
  let data: T;
  try { data = await readBoundedJson(paid, 1_048_576) as T; }
  catch { throw new Error(`Payment settled but response was invalid JSON; recover query ${payment.queryId}; settlement ${settlementId}`); }
  if ((data as { status?: string }).status !== "completed") {
    throw new Error(`Payment settled; research is ${String((data as { status?: string }).status ?? "pending")}. Recover query ${payment.queryId}; settlement ${settlementId}`);
  }
  if ((data as { queryId?: string }).queryId !== payment.queryId) throw new Error("Paid response query identity mismatched; preserve the original payment journal for recovery");
  clearPending(input.journalFile);
  return { data, settlementId, amountPaid: payment.amountUsdc };
  } finally { fs.rmdirSync(lock); }
}

export async function recoverResearch<T>(baseUrl: string, journalFile: string, fetchImpl: typeof fetch = fetch): Promise<{
  payment: PendingPayment; data: T | null; httpStatus: number;
}> {
  const origin = assertCallerTransport(baseUrl);
  const payment = readPending(journalFile);
  if (!payment) throw new Error("No payment recovery journal exists");
  if (payment.origin && origin !== payment.origin)
    throw new Error("Recovery origin differs from the original payment; preserve the journal and select its original server");
  const lock = `${journalFile}.lock`;
  let ownsLock = false;
  try { fs.mkdirSync(lock); ownsLock = true; } catch { /* Read-only inspection of an active/crashed original attempt remains available. */ }
  try {
  const response = await fetchImpl(`${baseUrl}/api/agent/ask?queryId=${encodeURIComponent(payment.queryId)}`, {
    redirect: "error", signal: AbortSignal.timeout(30000), cache: "no-store" });
  const data = response.ok ? await readBoundedJson(response, 1_048_576) as T : null;
  if (data && (data as { status?: string }).status === "completed" && (data as { queryId?: string }).queryId !== payment.queryId)
    throw new Error("Recovery response query identity mismatched; original payment journal retained");
  const current = readPending(journalFile);
  if (ownsLock && current?.queryId === payment.queryId && current.authorizationId === payment.authorizationId
    && current.network === payment.network && current.origin === payment.origin
    && response.ok && data && (data as { status?: string }).status === "completed") clearPending(journalFile);
  return { payment, data, httpStatus: response.status,
    ...(!ownsLock ? { instructions: "Original result inspected without changing the held journal. Stop all buyer processes; owner must inspect the original payment before removing a stale crash lock" } : {}) };
  } finally { if (ownsLock) fs.rmdirSync(lock); }
}
