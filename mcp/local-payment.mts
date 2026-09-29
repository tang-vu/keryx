import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import type { PrivateKeyAccount } from "viem/accounts";

const NETWORK = "eip155:5042002";
const USDC = "0x3600000000000000000000000000000000000000";
const GATEWAY = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

export type PendingPayment = {
  queryId: string;
  authorizationId: string;
  amountUsdc: string;
  status: "submitted" | "settled" | "unconfirmed";
  settlementId?: string;
  paymentResponse?: string;
  httpStatus?: number;
};

export function readPending(file: string): PendingPayment | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as PendingPayment; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function savePending(file: string, payment: PendingPayment): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payment, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function createPending(file: string, payment: PendingPayment): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Exclusive creation prevents two concurrent MCP calls from submitting different authorizations.
  fs.writeFileSync(file, JSON.stringify(payment, null, 2), { flag: "wx", mode: 0o600 });
}

export function clearPending(file: string): void {
  fs.rmSync(file, { force: true });
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
  journalFile: string; maxAmountUsdc: number; fetchImpl?: typeof fetch;
}): Promise<{ data: T; settlementId: string; amountPaid: string }> {
  const prior = readPending(input.journalFile);
  if (prior) throw new Error(`A previous payment may have settled. Recover query ${prior.queryId} before paying again; journal: ${input.journalFile}`);
  const request = JSON.stringify(input.body);
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = { "content-type": "application/json", accept: "application/json" };
  const challengeResponse = await fetchImpl(input.url, { method: "POST", headers, body: request });
  if (challengeResponse.status !== 402) throw new Error(`Expected a 402 quote, received HTTP ${challengeResponse.status}`);
  const encoded = challengeResponse.headers.get("PAYMENT-REQUIRED");
  if (!encoded) throw new Error("402 quote omitted PAYMENT-REQUIRED");
  const challenge = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
    x402Version: number; resource?: unknown; accepts?: Requirements[];
  };
  if (challenge.x402Version !== 2) throw new Error("Unsupported x402 version");
  const terms = challenge.accepts?.find((item) => item.network === NETWORK && item.scheme === "exact");
  if (!terms || terms.asset.toLowerCase() !== USDC || terms.extra?.name !== "GatewayWalletBatched"
    || terms.extra.version !== "1" || String(terms.extra.verifyingContract).toLowerCase() !== GATEWAY.toLowerCase()
    || !/^0x[0-9a-f]{40}$/i.test(terms.payTo) || !/^[1-9]\d*$/.test(terms.amount)) {
    throw new Error("Quote contains unsupported payment requirements");
  }
  const micros = BigInt(terms.amount);
  if (micros > BigInt(Math.round(input.maxAmountUsdc * 1_000_000))) {
    throw new Error(`Quote ${Number(micros) / 1_000_000} USDC exceeds the permitted total ${input.maxAmountUsdc} USDC`);
  }
  const signed = await new BatchEvmScheme(input.account).createPaymentPayload(2, terms);
  const authorization = signed.payload.authorization;
  const payment: PendingPayment = {
    queryId: queryId(input.account.address, terms.payTo, authorization.nonce),
    authorizationId: authorization.nonce,
    amountUsdc: (Number(micros) / 1_000_000).toString(), status: "submitted",
  };
  createPending(input.journalFile, payment);
  let paid: Response;
  try {
    const signature = Buffer.from(JSON.stringify({ ...signed, resource: challenge.resource ?? { url: input.url }, accepted: terms })).toString("base64");
    paid = await fetchImpl(input.url, { method: "POST", headers: { ...headers, "Payment-Signature": signature }, body: request });
  } catch (error) {
    savePending(input.journalFile, { ...payment, status: "unconfirmed" });
    throw new Error(`Payment outcome unknown for ${payment.queryId}; recover before paying again. ${String(error)}`);
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
  try { data = await paid.json() as T; }
  catch { throw new Error(`Payment settled but response was invalid JSON; recover query ${payment.queryId}; settlement ${settlementId}`); }
  if ((data as { status?: string }).status !== "completed") {
    throw new Error(`Payment settled; research is ${String((data as { status?: string }).status ?? "pending")}. Recover query ${payment.queryId}; settlement ${settlementId}`);
  }
  clearPending(input.journalFile);
  return { data, settlementId, amountPaid: payment.amountUsdc };
}

export async function recoverResearch<T>(baseUrl: string, journalFile: string, fetchImpl: typeof fetch = fetch): Promise<{
  payment: PendingPayment; data: T | null; httpStatus: number;
}> {
  const payment = readPending(journalFile);
  if (!payment) throw new Error("No payment recovery journal exists");
  const response = await fetchImpl(`${baseUrl}/api/agent/ask?queryId=${encodeURIComponent(payment.queryId)}`);
  const data = response.ok ? await response.json() as T : null;
  if (response.ok && data && (data as { status?: string }).status === "completed") clearPending(journalFile);
  return { payment, data, httpStatus: response.status };
}
