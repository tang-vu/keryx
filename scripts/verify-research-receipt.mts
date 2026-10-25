/** Verify downloaded receipt payloads; no environment, wallet or payment client. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyResearchReceipt } from "../lib/research-receipt-integrity";

export const MAX_RECEIPT_INPUT_BYTES = 16_777_216;
export const RECEIPT_REQUEST_TIMEOUT_MS = 30_000;
const usage = "Usage: npm run verify:receipt -- <receipt.json|https://keryx.cc/api/dispatch/.../receipt> [--expect sha256:...]";
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
class ReceiptInputError extends Error {}

function argumentsFor(args: string[]) {
  let target: string | undefined, expectedDigest: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--expect") {
      if (expectedDigest !== undefined || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("usage");
      expectedDigest = args[++index];
      if (!digestPattern.test(expectedDigest)) throw new Error("invalid-expected-digest");
    } else {
      if (!argument || argument.startsWith("-") || target !== undefined) throw new Error("usage");
      target = argument;
    }
  }
  if (!target) throw new Error("usage");
  return { target, expectedDigest };
}

async function localReceipt(filePath: string): Promise<unknown> {
  // Nonblocking open lets the regular-file check refuse Unix FIFOs/devices too.
  const file = await open(resolve(filePath), constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new ReceiptInputError("receipt-file-unavailable");
    if (stat.size > MAX_RECEIPT_INPUT_BYTES) throw new ReceiptInputError("receipt-input-too-large");
    const chunks: Buffer[] = []; let size = 0;
    while (size <= MAX_RECEIPT_INPUT_BYTES) {
      const chunk = Buffer.allocUnsafe(Math.min(65_536, MAX_RECEIPT_INPUT_BYTES + 1 - size));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_RECEIPT_INPUT_BYTES) throw new ReceiptInputError("receipt-input-too-large");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))); }
    catch { throw new ReceiptInputError("invalid-receipt-json"); }
  } finally { await file.close(); }
}

async function responseReceipt(response: Response): Promise<unknown> {
  if (!response.body) throw new ReceiptInputError("invalid-receipt-json");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RECEIPT_INPUT_BYTES) throw new ReceiptInputError("receipt-input-too-large");
      parts.push(decoder.decode(value, { stream: true }));
    }
    return JSON.parse(parts.join("") + decoder.decode());
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export async function verifyReceiptCli(args: string[], options: { fetch?: typeof fetch; signal?: AbortSignal } = {}) {
  if (args.length === 1 && args[0] === "--help") return { exitCode: 0, stdout: usage + "\n", stderr: "" };
  let parsed: ReturnType<typeof argumentsFor>;
  try { parsed = argumentsFor(args); }
  catch (error) {
    const detail = error instanceof Error && error.message === "invalid-expected-digest"
      ? "INVALID — --expect must be a sha256:<64 lowercase hex> digest\n" : "";
    return { exitCode: 2, stdout: "", stderr: detail + usage + "\n" };
  }
  const { target, expectedDigest } = parsed;
  try {
    let receipt: unknown, responseDigest: string | undefined, secureResponse: boolean | undefined;
    if (/^https?:\/\//iu.test(target)) {
      const destination = new URL(target);
      if (destination.username || destination.password) throw new ReceiptInputError("receipt-url-unavailable");
      const deadline = AbortSignal.timeout(RECEIPT_REQUEST_TIMEOUT_MS);
      const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
      try {
        const response = await (options.fetch ?? fetch)(destination, { headers: { Accept: "application/json" },
          redirect: "error", credentials: "omit", cache: "no-store", signal });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new ReceiptInputError("receipt-request-failed");
        }
        receipt = await responseReceipt(response);
        secureResponse = new URL(response.url || destination.href).protocol === "https:";
        responseDigest = response.headers.get("x-keryx-receipt-digest") ?? undefined;
      } catch (error) {
        if (signal.aborted) throw new ReceiptInputError("receipt-request-aborted");
        if (error instanceof ReceiptInputError) throw error;
        throw new ReceiptInputError("receipt-response-unavailable");
      }
    } else receipt = await localReceipt(target);
    const result = verifyResearchReceipt(receipt);
    if (!result.valid) return { exitCode: 1, stdout: "", stderr: `INVALID — ${result.reason ?? "receipt verification failed"}\n` };
    if (responseDigest !== undefined && responseDigest !== result.actualDigest)
      return { exitCode: 1, stdout: "", stderr: "INVALID — response header digest does not match the receipt\n" };
    if (expectedDigest !== undefined && expectedDigest !== result.actualDigest)
      return { exitCode: 1, stdout: "", stderr: "INVALID — receipt does not match the separately retained digest\n" };
    const lines = [`VALID — ${result.actualDigest}`];
    if (responseDigest !== undefined) lines.push(`Matched X-Keryx-Receipt-Digest from the ${secureResponse ? "HTTPS" : "HTTP"} response`);
    if (expectedDigest !== undefined) lines.push("Matched the separately retained expected digest");
    lines.push("Integrity scope: exported payload; authenticity requires the HTTPS origin or a separately retained digest");
    if (responseDigest !== undefined && secureResponse === false && expectedDigest === undefined)
      lines.push("Warning: HTTP does not authenticate the response origin; retain/compare the digest separately");
    return { exitCode: 0, stdout: lines.join("\n") + "\n", stderr: "" };
  } catch (error) {
    const code = error instanceof ReceiptInputError ? error.message : "receipt-input-unavailable";
    return { exitCode: 1, stdout: "", stderr: `INVALID — ${code}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await verifyReceiptCli(process.argv.slice(2));
  process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.exitCode;
}
