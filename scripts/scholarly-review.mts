import fs from "node:fs/promises";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { getDb } from "../lib/db/index.ts";
import { paperReviewers } from "../lib/scholarly/rights-authority.ts";
import { paperDecisionMessage, paperDecisionSchema, signedPaperDecisionSchema } from "../lib/scholarly/rights-protocol.ts";

const [command, input, output, confirmation] = process.argv.slice(2);
async function writePrivate(file: string, data: unknown) {
  if (!file) throw new Error("An explicit private output file is required");
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
async function readBounded(file: string) {
  if ((await fs.stat(file)).size > 32_768) throw new Error("Review artifact exceeds size bound");
  return JSON.parse(await fs.readFile(file, "utf8"));
}
try {
  if (command === "inspect" && input && output) {
    const db = await getDb();
    if (!db.getPaperState) throw new Error("Scholarly review requires the supported SQLite datastore");
    const state = await db.getPaperState(input);
    if (!state) throw new Error("Scholarly enrollment not found");
    await writePrivate(output, { state, policy: "supervised-testnet-v1",
      instructions: "Independently inspect exact version distribution permission, commercial scope, coauthor/publisher requirements, embargo and expiry. Evidence references are never fetched automatically. Sign a complete explicit decision artifact only after review." });
    console.log(JSON.stringify({ sourceId: input, declarationId: state.declarationId, previousDecisionId: state.decisionId, privateReportWritten: true }));
  } else if (command === "sign" && input && output && confirmation) {
    const decision = paperDecisionSchema.parse(await readBounded(input));
    if (confirmation !== decision.declarationId) throw new Error("Confirmation must equal the exact declaration ID reviewed");
    const key = process.env.KERYX_SCHOLARLY_REVIEWER_PRIVATE_KEY;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Explicit local operator signing key is required");
    const account = privateKeyToAccount(key as `0x${string}`);
    if (!paperReviewers().includes(account.address.toLowerCase()) || decision.reviewer !== account.address.toLowerCase())
      throw new Error("Local signing key is not the configured decision reviewer");
    const signature = await account.signMessage({ message: paperDecisionMessage(decision) });
    await writePrivate(output, { decision, signature });
    console.log(JSON.stringify({ declarationId: decision.declarationId, reviewer: decision.reviewer, outcome: decision.outcome, signedArtifactWritten: true, applied: false }));
  } else if (command === "apply" && input && output) {
    const review = signedPaperDecisionSchema.parse(await readBounded(input));
    if (output !== review.decision.declarationId) throw new Error("Confirmation must equal the signed declaration ID");
    const db = await getDb();
    if (!db.reviewPaper) throw new Error("Scholarly review requires the supported SQLite datastore");
    const state = await db.reviewPaper(review);
    console.log(JSON.stringify({ sourceId: state.sourceId, declarationId: state.declarationId, decisionId: state.decisionId,
      status: state.review?.decision.outcome, publicSummary: state.review?.decision.publicSummary, settlement: "not performed" }));
  } else {
    console.log(`Usage:
  npm run scholarly:review -- inspect <source-id> <private-report.json>
  npm run scholarly:review -- sign <unsigned-decision.json> <signed-decision.json> <declaration-id>
  npm run scholarly:review -- apply <signed-decision.json> <declaration-id>
Only sign loads the explicitly configured LOCAL reviewer key. Apply verifies the detached signature
against KERYX_SCHOLARLY_REVIEWERS; production needs only that public allowlist. No command pays,
changes a registry recipient, fetches private evidence, or automatically approves a declaration.`);
    if (command !== "--help") process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Scholarly review failed");
  process.exitCode = 1;
}
