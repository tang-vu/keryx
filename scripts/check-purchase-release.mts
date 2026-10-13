/** Offline local files only; no environment loader, provider, storage or deploy imports. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { evaluatePurchaseRelease, MAX_PURCHASE_RELEASE_BYTES } from "../lib/research-audit/purchase-release-gate.ts";

const usage = "Purchase release check refused. Usage: <policy.json> <baseline.json> <candidate.json> "
  + "--policy-sha256 <reviewed SHA-256> --candidate-source <full commit> --input-sha256 <retained input SHA-256>.\n";
async function localFile(file: string) {
  // UNC and URL inputs are not offline local files. Windows drive-letter paths remain supported.
  if (/^[a-z][a-z0-9+.-]*:/i.test(file) && !/^[a-z]:[\\/]/i.test(file) || /^[\\/]{2}/.test(file)) throw new Error();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_PURCHASE_RELEASE_BYTES) throw new Error();
    const bytes = Buffer.alloc(MAX_PURCHASE_RELEASE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > MAX_PURCHASE_RELEASE_BYTES) throw new Error();
    // Preserve a BOM so JSON refuses it; stripping bytes would break exact artifact hashing.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
  } finally { await handle.close(); }
}

try {
  const [policyFile, baselineFile, candidateFile, ...flags] = process.argv.slice(2);
  if (!policyFile || !baselineFile || !candidateFile || flags.length !== 6) throw new Error();
  const options = new Map<string, string>();
  for (let index = 0; index < flags.length; index += 2) {
    if (!["--policy-sha256", "--candidate-source", "--input-sha256"].includes(flags[index]) || options.has(flags[index])) throw new Error();
    options.set(flags[index], flags[index + 1]);
  }
  const result = await evaluatePurchaseRelease({ policyJson: await localFile(policyFile), baselineJson: await localFile(baselineFile),
    candidateJson: await localFile(candidateFile) }, { policySha256: options.get("--policy-sha256")!,
    candidateSourceCommit: options.get("--candidate-source")!, inputSha256: options.get("--input-sha256")! });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = result.status === "pass" ? 0 : result.status === "flagged" ? 1 : 2;
} catch {
  // Keep malformed/private payloads, filesystem paths and credentials out of refusals.
  process.stderr.write(usage); process.exitCode = 3;
}
