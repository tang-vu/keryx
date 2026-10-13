/** Local retained-content evaluation only; no environment, provider, signer or reward graph. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { evaluateRetainedSkips, OFFLINE_COUNTERFACTUAL_POLICY } from "../lib/research-audit/counterfactual-offline.ts";

const usage = "Retained skip evaluation refused. Usage: <local-input.json>. "
  + "Only completed-run decisions, observed exact reads, hash-bound reference literals and post-run retained bodies are accepted.\n";
try {
  const [file, ...extra] = process.argv.slice(2);
  if (!file || extra.length || /^[a-z][a-z0-9+.-]*:/i.test(file) && !/^[a-z]:[\\/]/i.test(file) || /^[\\/]{2}/.test(file)) throw new Error();
  const maximum = OFFLINE_COUNTERFACTUAL_POLICY.maximumInputBytes;
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  let value: unknown;
  try {
    const stat = await handle.stat(); if (!stat.isFile() || stat.size > maximum) throw new Error();
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > maximum) throw new Error();
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)));
  } finally { await handle.close(); }
  const result = await evaluateRetainedSkips(value);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  // An incomplete/empty selected sample is retained but is never a completed assessment.
  process.exitCode = result.sampledLiteralMissRate === null ? 2 : 0;
} catch { process.stderr.write(usage); process.exitCode = 3; }
