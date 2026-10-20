import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_PROCUREMENT_BYTES, parseEvidenceProcurement } from "../lib/evidence-procurement/contracts.ts";
import { buildEvidenceProcurement } from "../lib/evidence-procurement/engine.ts";
import { exportEvidenceProcurement, procurementReceiptFormat } from "../lib/evidence-procurement/export.ts";
import { publishPrivateText } from "../lib/operator/private-text-export.ts";

const usage = "Usage: npm run evidence:procurement -- --file PRIVATE_PACKET.json [--format json|markdown|csv] [--out NEW_FILE]\nAssess supplied version-1 evidence procurement locally. No environment credentials, provider requests, signing, purchases or rewards. Default JSON prints the private result; with --out it saves only the original packet for reimport. Markdown/CSV prints a readable receipt or saves it with --out, refusing overwrite. Formatted receipts are not restorable, are bounded to 524288 UTF-8 bytes, and results are recomputed on each use.";

/** Reject special files before reading and bound actual bytes, including file growth. */
export async function readEvidenceProcurementPacket(path: string) {
  const flags = process.platform === "win32" ? "r" : constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;
  const file = await open(path, flags);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_PROCUREMENT_BYTES) throw new Error("Invalid procurement file");
    const bytes = Buffer.alloc(MAX_PROCUREMENT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await file.stat();
    if (length !== before.size || length > MAX_PROCUREMENT_BYTES || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Changed procurement file");
    return parseEvidenceProcurement(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))));
  } finally { await file.close(); }
}

export async function runEvidenceProcurement(args: string[]) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) { console.log(usage); return; }
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i], value = args[i + 1];
    if (!["--file", "--out", "--format"].includes(name) || options[name] !== undefined || !value || value.startsWith("--"))
      throw new Error("Invalid procurement options");
    options[name] = value;
  }
  if (!options["--file"]) throw new Error("Missing procurement file");
  const format = procurementReceiptFormat(options["--format"]);
  const packet = await readEvidenceProcurementPacket(options["--file"]);
  if (format !== "json") {
    const receipt = await exportEvidenceProcurement(packet, format);
    if (options["--out"]) {
      await publishPrivateText(options["--out"], receipt.text);
      console.log("Private evidence procurement receipt saved. No provider contacted or payment started.");
    } else console.log(receipt.text);
    return;
  }
  const procurement = await buildEvidenceProcurement(packet);
  if (options["--out"]) {
    await publishPrivateText(options["--out"], JSON.stringify(packet));
    console.log("Validated private evidence procurement packet saved. No provider contacted or payment started.");
  } else console.log(JSON.stringify({ procurement }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEvidenceProcurement(process.argv.slice(2)).catch(() => {
    console.error("Private evidence procurement unavailable. Check the bounded packet and use a new output filename. Retain existing files; private details omitted.");
    process.exitCode = 1;
  });
}
