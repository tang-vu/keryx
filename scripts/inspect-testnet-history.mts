/** Read-only restoration acceptance. No environment credentials, signing or live database. */
import { createHash } from "node:crypto";
import { getTestnetArchive } from "../lib/history/testnet-archive.ts";
import { buildResearchReceipt, verifyResearchReceipt } from "../lib/research-receipt.ts";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--manifest") throw new Error("Usage: inspect-testnet-history --manifest ABSOLUTE_MANIFEST");
process.env.KERYX_TESTNET_ARCHIVE_MANIFEST = args[1];
const archive = await getTestnetArchive();
if (!archive) throw new Error("Archive unavailable");
try {
  const summary = await archive.summary();
  const expectedIds = ["3a43c6c2-fddf-40ce-98a1-701a2a58b439", "fe7c06fd-65da-41a6-867c-0597a63304df", "2405a2ea-7ee3-4f0d-88b9-f221df791070"];
  const dispatches = [];
  for (const id of expectedIds) {
    const run = await archive.getQueryRun(id);
    if (!run) throw new Error("Expected historical dispatch unavailable");
    const payments = await archive.listCreatorPaymentAttemptsByQuery(id);
    const receipt = buildResearchReceipt(run, payments);
    if (!verifyResearchReceipt(receipt).valid) throw new Error("Historical receipt integrity failed");
    dispatches.push({ id, createdAt: run.createdAt, answerSha256: createHash("sha256").update(run.answer).digest("hex"),
      paymentStates: payments.map(payment => ({ kind: payment.kind, status: payment.settlementStatus, network: payment.network })) });
  }
  const seen = new Set<string>();
  let before: { createdAt: string; id: string } | undefined;
  for (let page = 0; page <= Math.ceil(summary.totalQueryRuns / 50); page++) {
    const runs = await archive.listRecentQueries(50, before);
    if (!runs.length) break;
    for (const run of runs) { if (seen.has(run.id)) throw new Error("Historical paging duplicated a dispatch"); seen.add(run.id); }
    const last = runs[runs.length - 1]; before = { createdAt: last.createdAt, id: last.id };
  }
  if (seen.size !== summary.totalQueryRuns) throw new Error("Historical paging is incomplete");
  console.log(JSON.stringify({ archive: archive.info, summary, dispatches, pagedQueryRuns: seen.size, receiptIntegrity: "verified", authority: "read-only" }, null, 2));
} finally { archive.close(); }
