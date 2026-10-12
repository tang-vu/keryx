/** Offline local-file observer. No environment loader, provider, HTTP, DB or wallet graph. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { auditResearchEvidence } from "../lib/research-audit/evidence-audit.ts";
import { MAX_EVIDENCE_AUDIT_BYTES } from "../lib/research-audit/evidence-audit-contract.ts";

const help = `Audit a portable research receipt, supplied human claim reviews, costs and captured decisions.
Usage: node --import tsx scripts/research-evidence-audit.mts INPUT.json [--trust SEPARATELY_RETAINED.json]
Inputs are bounded regular local files; URLs, stdin, application state and credentials are not used.
Trust file: {"expectedReceiptDigest":"sha256:...","expectedDecisionDigests":[{"id":"UUID","digest":"sha256:..."}]}
Without independently retained digests, comparisons are labeled self-check-only.
Exit 0 produces an observation, including unknown, ambiguous and mismatched rows; it does not certify payment.
Exit 1 refuses invalid data. Output can contain private cost references: retain it in an owner-controlled file.
Template and instructions: docs/research-evidence-audit.md and docs/research-evidence-audit-example.json
`;

async function readBounded(path: string, maximum: number) {
  // Refuse SMB and Win32/NT device namespaces before open can use ambient authentication.
  // DOS aliases may open a console/device even when followed by an extension.
  if (/^[a-z]+:\/\//i.test(path) || path === "-" || /^[a-z]:(?![\\/])/iu.test(path) ||
      /^[\\/]{2}|^[\\/]\?\?[\\/]/u.test(path) ||
      path.split(/[\\/]/u).some(part => /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .:]|$)/iu.test(part))) throw Error();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) throw Error();
    const bytes = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await handle.read(bytes, size, bytes.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size > maximum) throw Error();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
  } finally { await handle.close(); }
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") process.stdout.write(help);
  else {
    if (!(args.length === 1 || args.length === 3 && args[1] === "--trust") || args[0].startsWith("--")) throw Error();
    const trust = args.length === 3 ? JSON.parse(await readBounded(args[2], 262_144)) : {};
    const result = await auditResearchEvidence(await readBounded(args[0], MAX_EVIDENCE_AUDIT_BYTES), trust);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
} catch {
  process.stderr.write("Evidence audit refused the local input. Run --help for its contract.\n");
  process.exitCode = 1;
}
