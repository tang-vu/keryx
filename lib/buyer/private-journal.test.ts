import { mkdtemp, readFile, writeFile, unlink, rmdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPrivateQuote } from "../a2a/private-quote";
import { preparePrivateResearchIntent } from "../a2a/private-research-intent";
import { createPrivateAuthorization, PRIVATE_RESEARCH_RESOURCE } from "./private-request-commitment";
import { buyerTypedData, BUYER_NETWORK, BUYER_USDC, BUYER_GATEWAY } from "./protocol";
import { createPrivateBuyerJournal, readPrivateBuyerJournal, claimPrivateBuyerSubmission } from "./private-journal";
import { recoverPrivateBuyerResult } from "./private-recovery";
import { recoverPrivateBuyerWorkflow } from "./private-recovery-workflow";
import { preparePrivateBuyerJournal } from "./private-checkout-preparation";
import * as buyerJournal from "./journal";

const account = privateKeyToAccount(generatePrivateKey());
const merchants = { privatePayee: `0x${"2".repeat(40)}`, publicResearchPayee: `0x${"3".repeat(40)}` };
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    for (const name of ["private-intent.json", "private-submission-attempt.json", "snapshot.json"]) await unlink(join(root, "journal", name)).catch(() => undefined);
    await rmdir(join(root, "journal")).catch(() => undefined); await rmdir(root);
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "keryx-private-buyer-")); roots.push(root);
  const directory = join(root, "journal");
  const quote = createPrivateQuote({ question: "Synthetic private journal question", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" }, {
    provider: { modelId: "deepseek-flash", provider: "deepseek", baseUrl: "https://synthetic.example/v1", apiKey: "synthetic-not-secret" }, merchants,
    requirement: { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: merchants.privatePayee, maxTimeoutSeconds: 604860,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } } });
  const fresh = await createPrivateAuthorization(quote.request, quote.requirement, account.address, merchants, 1788912000000);
  const submission = { request: fresh.request, salt: fresh.salt, payment: { authorization: fresh.authorization,
    signature: await account.signTypedData(buyerTypedData(fresh.authorization)) } };
  const intent = await preparePrivateResearchIntent(submission, quote.requirement, merchants);
  const value = { schema: "keryx-private-buyer-intent-v1", resource: PRIVATE_RESEARCH_RESOURCE, id: intent.id, requirement: quote.requirement, submission };
  return { directory, value, quote };
}

it("validates independent quote limits before signing and prepares only one durable journal concurrently", async () => {
  const { directory, quote } = await fixture();
  const sign = vi.fn(account.signTypedData.bind(account));
  const signer = { address: account.address, signTypedData: sign };
  await expect(preparePrivateBuyerJournal(directory, quote, quote.request, merchants,
    { maxTotalMicros: "49999", maxServiceFeeMicros: "20000" }, signer)).rejects.toThrow("preparation failed");
  expect(sign).not.toHaveBeenCalled();
  const limits = { maxTotalMicros: "50000", maxServiceFeeMicros: "20000" };
  const results = await Promise.allSettled([preparePrivateBuyerJournal(directory, quote, quote.request, merchants, limits, signer),
    preparePrivateBuyerJournal(directory, quote, quote.request, merchants, limits, signer)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(sign).toHaveBeenCalledTimes(1);
  const restored = await readPrivateBuyerJournal(directory, account.address, merchants);
  expect(restored.submission.request).toEqual(quote.request);
  expect(restored.submission.payment.authorization.value).toBe("50000");
  await expect(access(join(directory, "private-submission-attempt.json"))).rejects.toThrow();
});

it("keeps the directory reserved after signer failure without leaking its error or signing again", async () => {
  const { directory, quote } = await fixture();
  const sign = vi.fn(async (): Promise<`0x${string}`> => { throw new Error("synthetic-private-signer-detail"); });
  const signer = { address: account.address, signTypedData: sign };
  const limits = { maxTotalMicros: "50000", maxServiceFeeMicros: "20000" };
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(preparePrivateBuyerJournal(directory, quote, quote.request, merchants, limits, signer))
      .rejects.toThrow("Private buyer preparation failed. Keep any created journal directory; do not submit or regenerate its authorization.");
  }
  expect(sign).toHaveBeenCalledTimes(1);
  await expect(access(join(directory, "private-intent.json"))).rejects.toThrow();
});

it("rejects a signature from a different account before persisting an intent", async () => {
  const { directory, quote } = await fixture();
  const other = privateKeyToAccount(generatePrivateKey());
  await expect(preparePrivateBuyerJournal(directory, quote, quote.request, merchants,
    { maxTotalMicros: "50000", maxServiceFeeMicros: "20000" },
    { address: account.address, signTypedData: other.signTypedData.bind(other) })).rejects.toThrow("preparation failed");
  await expect(access(join(directory, "private-intent.json"))).rejects.toThrow();
});

it("denies resumption after a partial journal write and does not request a replacement signature", async () => {
  const { directory, quote } = await fixture();
  const sign = vi.fn(account.signTypedData.bind(account));
  const signer = { address: account.address, signTypedData: sign };
  const limits = { maxTotalMicros: "50000", maxServiceFeeMicros: "20000" };
  const write = vi.spyOn(buyerJournal, "writeBuyerFile").mockImplementationOnce(async (path, name) => {
    await writeFile(join(path, name), "{");
    throw new Error("synthetic-write-failure");
  });
  try {
    await expect(preparePrivateBuyerJournal(directory, quote, quote.request, merchants, limits, signer)).rejects.toThrow("preparation failed");
  } finally { write.mockRestore(); }
  await expect(preparePrivateBuyerJournal(directory, quote, quote.request, merchants, limits, signer)).rejects.toThrow("preparation failed");
  expect(sign).toHaveBeenCalledTimes(1);
  await expect(claimPrivateBuyerSubmission(directory, account.address, merchants)).rejects.toThrow();
  await expect(access(join(directory, "private-submission-attempt.json"))).rejects.toThrow();
});

it("restores the same signed authorization and grants only one local submission attempt across concurrent readers", async () => {
  const { directory, value } = await fixture();
  await createPrivateBuyerJournal(directory, value, account.address, merchants);
  const restored = await readPrivateBuyerJournal(directory, account.address, merchants);
  expect(restored.submission.payment.authorization.nonce).toBe(value.submission.payment.authorization.nonce);
  expect(restored.submission.payment.signature).toBe(value.submission.payment.signature);
  const attempts = await Promise.all([claimPrivateBuyerSubmission(directory, account.address, merchants), claimPrivateBuyerSubmission(directory, account.address, merchants)]);
  expect(attempts.filter(attempt => attempt.claimed)).toHaveLength(1);
  expect(await claimPrivateBuyerSubmission(directory, account.address, merchants)).toEqual({ claimed: false });
  expect(await readFile(join(directory, "private-submission-attempt.json"), "utf8")).not.toContain(value.submission.request.question);
  await expect(createPrivateBuyerJournal(directory, value, account.address, merchants)).rejects.toThrow();
});

it("denies foreign owners and edited intent content instead of regenerating an authorization", async () => {
  const { directory, value } = await fixture();
  await createPrivateBuyerJournal(directory, value, account.address, merchants);
  await expect(readPrivateBuyerJournal(directory, merchants.publicResearchPayee, merchants)).rejects.toThrow("owner");
  await writeFile(join(directory, "private-intent.json"), JSON.stringify({ ...value, submission: { ...value.submission,
    request: { ...value.submission.request, question: "Changed question" } } }));
  await expect(claimPrivateBuyerSubmission(directory, account.address, merchants)).rejects.toThrow();
});

it("treats a partial attempt marker as submitted and bounds recovery file bytes", async () => {
  const { directory, value } = await fixture();
  await createPrivateBuyerJournal(directory, value, account.address, merchants);
  await writeFile(join(directory, "private-submission-attempt.json"), "{");
  expect(await claimPrivateBuyerSubmission(directory, account.address, merchants)).toEqual({ claimed: false });
  await writeFile(join(directory, "private-intent.json"), "x".repeat(65537));
  await expect(readPrivateBuyerJournal(directory, account.address, merchants)).rejects.toThrow("size limit");
});

it("recovers through the private read endpoint without resubmission and rejects another context or inconsistent accounting", async () => {
  const { directory, value } = await fixture();
  await createPrivateBuyerJournal(directory, value, account.address, merchants);
  await claimPrivateBuyerSubmission(directory, account.address, merchants);
  const view = { wallet: account.address.toLowerCase(), format: "private-result-v1", status: "awaiting-execution",
    request: { question: value.submission.request.question, researchMode: "quick", model: "deepseek-flash", packageVersion: "1.0.0", creatorBudgetMicros: "30000" },
    spend: { format: "private-spend-v1", chainFinalityVerified: false, incoming: { status: "settled", priceMicros: "50000" },
      creator: { budgetMicros: "30000", committedMicros: "0", unresolvedMicros: "0", processingMicros: "0", confirmedMicros: "0", uncommittedMicros: "30000", payments: [] } }, result: null };
  const http = vi.fn(async () => Response.json(view));
  expect(await recoverPrivateBuyerResult(directory, account.address, merchants, "keryx_session=synthetic", http)).toEqual(view);
  expect(http).toHaveBeenCalledTimes(1);
  const calls = http.mock.calls as unknown as [string, RequestInit][];
  expect(calls[0][0]).toBe("https://keryx.cc/api/me/private-jobs/result");
  expect(calls[0][1]).toMatchObject({ method: "POST", redirect: "error", body: JSON.stringify({ id: value.id }) });
  expect(JSON.stringify(calls)).not.toContain(value.submission.payment.signature);
  expect(JSON.stringify(calls)).not.toContain(value.submission.salt);
  expect(await claimPrivateBuyerSubmission(directory, account.address, merchants)).toEqual({ claimed: false });
  for (const patch of [{ wallet: merchants.publicResearchPayee }, { request: { ...view.request, question: "Changed" } },
    { status: "awaiting-payment" },
    { spend: { ...view.spend, creator: { ...view.spend.creator, committedMicros: "1", unresolvedMicros: "1", uncommittedMicros: "29999",
      payments: [{ kind: "fetch", sourceId: "synthetic-source", payee: merchants.privatePayee, amountMicros: "1", status: "confirmed", evidenceSource: "circle-transfer-search", reference: "synthetic-reference" }] } } },
    { spend: { ...view.spend, creator: { ...view.spend.creator, uncommittedMicros: "30001" } } }])
    await expect(recoverPrivateBuyerResult(directory, account.address, merchants, "keryx_session=synthetic", async () => Response.json({ ...view, ...patch }))).rejects.toThrow("does not match");
  await expect(recoverPrivateBuyerResult(directory, account.address, merchants, "keryx_session=synthetic", async () => new Response("private-error-body", { status: 401 }))).rejects.toThrow("live account session");
  await expect(recoverPrivateBuyerResult(directory, account.address, merchants, "keryx_session=synthetic; other=secret", http)).rejects.toThrow();
});

it("completes CLI recovery in a temporary session and writes private output only after confirmed sign-out", async () => {
  const { directory, value } = await fixture();
  await createPrivateBuyerJournal(directory, value, account.address, merchants);
  const output = join(directory, "snapshot.json");
  let refuseSignout = true;
  const http = vi.fn(async (url: string) => {
    if (url.endsWith("/api/auth/nonce")) return Response.json({ nonce: "syntheticNonce12345" });
    if (url.endsWith("/api/auth/verify")) return Response.json({ ok: true }, { headers: { "set-cookie": "keryx_session=synthetic.session.cookie; Secure; HttpOnly" } });
    if (url.endsWith("/api/auth/signout")) {
      await expect(access(output)).rejects.toThrow();
      return refuseSignout ? new Response("synthetic-error", { status: 503 }) : Response.json({ ok: true });
    }
    expect(url).toBe("https://keryx.cc/api/me/private-jobs/result");
    return Response.json({ wallet: account.address.toLowerCase(), format: "private-result-v1", status: "awaiting-execution",
      request: { question: value.submission.request.question, researchMode: "quick", model: "deepseek-flash", packageVersion: "1.0.0", creatorBudgetMicros: "30000" },
      spend: { format: "private-spend-v1", chainFinalityVerified: false, incoming: { status: "settled", priceMicros: "50000" },
        creator: { budgetMicros: "30000", committedMicros: "0", unresolvedMicros: "0", processingMicros: "0", confirmedMicros: "0", uncommittedMicros: "30000", payments: [] } }, result: null });
  });
  await expect(recoverPrivateBuyerWorkflow(directory, merchants, account, { output, http })).rejects.toThrow("revocation could not be confirmed");
  await expect(access(output)).rejects.toThrow();
  refuseSignout = false; http.mockClear();
  const summary = await recoverPrivateBuyerWorkflow(directory, merchants, account, { output, http });
  expect(summary).toMatchObject({ snapshotWritten: true, signOutConfirmed: true, paymentRequestsSent: 0, status: "awaiting-execution" });
  expect(http.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/api/auth/nonce", "/api/auth/verify", "/api/me/private-jobs/result", "/api/auth/signout"]);
  expect(JSON.stringify(summary)).not.toContain(value.submission.request.question);
  expect(JSON.stringify(summary)).not.toContain(value.id);
  const saved = await readFile(output, "utf8");
  expect(JSON.parse(saved).evidence).toBe("server-reported");
  expect(saved).not.toContain("synthetic.session.cookie");
  expect(saved).not.toContain(value.submission.payment.signature);
  http.mockClear();
  await expect(recoverPrivateBuyerWorkflow(directory, merchants, account, { output, http })).rejects.toThrow("already exists");
  expect(http).not.toHaveBeenCalled();
  expect(await readFile(output, "utf8")).toBe(saved);
});
