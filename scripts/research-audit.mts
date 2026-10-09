/** Offline audit only: no env loading, database, gateway, provider, HTTP or application imports. */
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { createDecisionRecord, decisionRecordHash, verifyDecisionRecord } from "../lib/research-audit/decision-record.ts";
import { scorePurchases } from "../lib/research-audit/purchase-outcomes.ts";
import { classifyUsage } from "../lib/research-audit/usage-cohort.ts";
import { summarizeUsage } from "../lib/research-audit/usage-summary.ts";
import { sourceLearningRecord, learnedValue } from "../lib/research-audit/source-learning.ts";

const MAX_INPUT = 2 * 1024 * 1024;
const [command, file, expectedHash, ...extra] = process.argv.slice(2);
try {
  if (!file || extra.length || !["record", "verify", "score", "cohort", "usage", "learn"].includes(command)
    || (command !== "verify" && expectedHash)) throw new Error("Usage: research-audit <record|verify|score|cohort|usage|learn> <json-file> [retained-hash-for-verify]");
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let input;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_INPUT) throw new Error("Audit input must be a regular file no larger than 2 MiB");
    const buffer = Buffer.alloc(MAX_INPUT + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, null);
      if (!read.bytesRead) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > MAX_INPUT) throw new Error("Audit input exceeds 2 MiB");
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead)));
  } finally { await handle.close(); }
  let output;
  if (command === "record") { const record = createDecisionRecord(input); output = { record, hash: await decisionRecordHash(record) }; }
  else if (command === "verify") {
    const verified = await verifyDecisionRecord(input, expectedHash ?? "");
    output = { verified }; if (!verified) process.exitCode = 1;
  } else if (command === "score") output = scorePurchases(input.run, input.payments, input.network);
  else if (command === "cohort") output = classifyUsage(input);
  else if (command === "usage") output = summarizeUsage(input);
  else { const record = sourceLearningRecord(input.sourceId, input.topic, input.observations);
    output = { record, advisory: learnedValue(input.expectedValue, record) }; }
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
} catch {
  // Do not echo private input, path, malformed JSON, raw exception or provider values.
  process.stderr.write("Research audit refused the input. Check the documented command and contract.\n");
  process.exitCode = 1;
}
