import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
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

const account = privateKeyToAccount(generatePrivateKey());
const merchants = { privatePayee: `0x${"2".repeat(40)}`, publicResearchPayee: `0x${"3".repeat(40)}` };
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    for (const name of ["private-intent.json", "private-submission-attempt.json"]) await unlink(join(root, "journal", name)).catch(() => undefined);
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
  return { directory, value };
}

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
