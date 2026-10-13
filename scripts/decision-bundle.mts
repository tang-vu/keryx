/** Offline export tool: no env loader, app config, DB, network, provider or payment imports. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { MAX_READ_PACKET_BYTES } from "../lib/research-audit/actual-read-record.ts";
import { canonicalSignedDecisionBundle, MAX_SIGNED_DECISION_BUNDLE_BYTES, verifySignedDecisionBundle } from "../lib/research-audit/signed-decision-bundle.ts";
import { decisionAuditTrustAnchorFromPem, signDecisionBundle } from "../lib/research-audit/signed-decision-bundle-node.ts";

const help = `Offline signed decision EXPORT snapshots (Ed25519).
Usage:
  node --import tsx scripts/decision-bundle.mts sign packet.json [report-sha256]
  node --import tsx scripts/decision-bundle.mts anchor trusted-public-key.pem
  node --import tsx scripts/decision-bundle.mts verify bundle.json trusted-public-key.pem [packet-sha256] [report-sha256]
  node --import tsx scripts/decision-bundle.mts verify bundle.json --env [packet-sha256] [report-sha256]

sign requires KERYX_AUDIT_SIGNING_KEY_PEM containing a separately provisioned
Ed25519 PKCS8 audit private key. It never uses payment keys or generates keys.
verify requires a PUBLIC SPKI PEM obtained separately from the export, or --env
with KERYX_AUDIT_TRUSTED_PUBLIC_KEY_PEM. anchor prints its public key/fingerprint.
Capture stdout into a private local file when retaining a snapshot. All input
files must be bounded regular files. No network or application state is read.
Signature/integrity cannot prove settlement, truth, completeness or an independent
timestamp. A report digest only binds a separately retained report's bytes.
`;

async function readFileBounded(path: string, maximum: number): Promise<string> {
  // Admit the descriptor without waiting for a FIFO writer, then require a regular file.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) throw Error("Invalid input file");
    const buffer = Buffer.alloc(maximum + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, null);
      if (!result.bytesRead) break;
      bytesRead += result.bytesRead;
    }
    if (bytesRead > maximum) throw Error("Input file exceeds its bound");
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
  } finally { await handle.close(); }
}

try {
  const [command, file, third, fourth, fifth, ...extra] = process.argv.slice(2);
  if (command === "--help" && !file) process.stdout.write(help);
  else {
    if (!file || extra.length || !["sign", "anchor", "verify"].includes(command)) throw Error("Invalid command");
    let output;
    if (command === "anchor") {
      if (third || fourth || fifth) throw Error("Invalid anchor command");
      output = decisionAuditTrustAnchorFromPem(await readFileBounded(file, 8192));
    } else if (command === "sign") {
      if (fourth || fifth) throw Error("Invalid sign command");
      const packet = JSON.parse(await readFileBounded(file, MAX_READ_PACKET_BYTES));
      const bundle = await signDecisionBundle(packet, { signingKeyPem: process.env.KERYX_AUDIT_SIGNING_KEY_PEM ?? "",
        ...(third ? { reportDigest: third } : {}) });
      process.stdout.write(canonicalSignedDecisionBundle(bundle) + "\n");
    } else {
      if (!third) throw Error("Missing independent anchor");
      const bundle = JSON.parse(await readFileBounded(file, MAX_SIGNED_DECISION_BUNDLE_BYTES));
      const publicPem = third === "--env" ? process.env.KERYX_AUDIT_TRUSTED_PUBLIC_KEY_PEM ?? "" : await readFileBounded(third, 8192);
      const trusted = decisionAuditTrustAnchorFromPem(publicPem);
      const verification = await verifySignedDecisionBundle(bundle, trusted, {
        ...(fourth ? { expectedPacketDigest: fourth } : {}), ...(fifth ? { expectedReportDigest: fifth } : {}) });
      output = { ...verification, signatureScope: "export-snapshot", trust: "separately-supplied-public-key",
        settlement: "unproven", truth: "unproven", completeness: "unproven", independentTimestamp: "unproven" };
      if (!verification.verified) process.exitCode = 1;
    }
    if (output) process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  }
} catch {
  // Never echo a path, private key, private input or exception context.
  process.stderr.write("Decision bundle refused the input. Run --help for the offline contract.\n");
  process.exitCode = 1;
}
