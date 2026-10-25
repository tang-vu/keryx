import { afterEach, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { researchReceiptDigest } from "../lib/research-receipt-integrity";
import { MAX_RECEIPT_INPUT_BYTES, verifyReceiptCli } from "./verify-research-receipt.mts";

const directories: string[] = [], servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Test cleanup outside its temporary root");
    await rm(target, { recursive: true, force: true });
  }
});
function receipt(answer = "Private synthetic receipt 🧾") {
  const payload = { schema: "urn:keryx:research-receipt:1", dispatch: { answer } };
  return { payload, integrity: { algorithm: "sha256", canonicalization: "keryx-json-v1", scope: "payload", digest: researchReceiptDigest(payload) } };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "receipt-cli-test-")); directories.push(directory);
  const file = join(directory, "receipt.json"), value = receipt();
  await writeFile(file, JSON.stringify(value)); return { directory, file, value };
}
async function run(args: string[]) {
  try {
    const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/verify-research-receipt.mts", ...args], { timeout: 15_000, maxBuffer: 64_000 });
    return { ...result, code: 0 };
  } catch (error) { return error as { stdout: string; stderr: string; code: number }; }
}

it("verifies the real CLI entry point against a retained digest without changing the file", async () => {
  const f = await fixture(), original = await readFile(f.file);
  const result = await run([f.file, "--expect", f.value.integrity.digest]);
  expect(result.code).toBe(0); expect(result.stderr).toBe("");
  expect(result.stdout).toContain(`VALID — ${f.value.integrity.digest}`);
  expect(result.stdout).toContain("Matched the separately retained expected digest");
  expect(await readFile(f.file)).toEqual(original);
});

it.each(["missing-expect", "duplicate-expect", "unknown-option", "extra-target"])("refuses ambiguous CLI arguments: %s", async kind => {
  const f = await fixture();
  const args = kind === "missing-expect" ? [f.file, "--expect"] : kind === "duplicate-expect"
    ? [f.file, "--expect", f.value.integrity.digest, "--expect", f.value.integrity.digest]
    : kind === "unknown-option" ? [f.file, "--unknown"] : [f.file, "another.json"];
  const result = await run(args);
  expect(result.code).toBe(2); expect(result.stdout).toBe("");
});

it("refuses corrupted UTF-8 instead of validating a repaired receipt", async () => {
  const f = await fixture(), value = receipt("before\ufffdafter"), serialized = Buffer.from(JSON.stringify(value));
  const at = serialized.indexOf(Buffer.from("\ufffd"));
  await writeFile(f.file, Buffer.concat([serialized.subarray(0, at), Buffer.from([0xff]), serialized.subarray(at + 3)]));
  const result = await run([f.file]);
  expect(result.code).toBe(1); expect(result.stdout).toBe("");
});

it("does not echo private input text or local filenames in a parse failure", async () => {
  const f = await fixture(); await writeFile(f.file, '{"PRIVATE_FORBIDDEN_RECEIPT_TOKEN": malformed}');
  const result = await run([f.file]);
  expect(result.code).toBe(1); expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("PRIVATE_FORBIDDEN_RECEIPT_TOKEN"); expect(result.stderr).not.toContain(f.directory);
});

it("refuses redirects rather than verifying a different response origin or making a second request", async () => {
  const requests: string[] = [], value = receipt();
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if (req.url === "/redirect") res.writeHead(302, { location: "/receipt" }).end();
    else res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
  });
  servers.push(server); await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); if (!address || typeof address === "string") throw new Error();
  const result = await run([`http://127.0.0.1:${address.port}/redirect`]);
  expect(result.code).toBe(1); expect(requests).toEqual(["/redirect"]); expect(result.stdout).toBe("");
});

it("keeps Unicode across HTTP chunks, accepts a UTF-8 BOM and binds a supplied response digest", async () => {
  const value = receipt("Tiếng Việt 🧾 \ufffd"), bytes = Buffer.from("\ufeff" + JSON.stringify(value));
  const body = () => new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const http = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
    expect(init).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Response(body(), { headers: { "x-keryx-receipt-digest": value.integrity.digest } });
  });
  const result = await verifyReceiptCli(["https://keryx.cc/api/dispatch/fixture/receipt"], { fetch: http });
  expect(result.exitCode).toBe(0); expect(result.stdout).toContain("Matched X-Keryx-Receipt-Digest from the HTTPS response");
  http.mockResolvedValueOnce(new Response(body(), { headers: { "x-keryx-receipt-digest": `sha256:${"0".repeat(64)}` } }));
  const mismatch = await verifyReceiptCli(["https://keryx.cc/api/dispatch/fixture/receipt"], { fetch: http });
  expect(mismatch.exitCode).toBe(1); expect(mismatch.stdout).toBe(""); expect(mismatch.stderr).toContain("header digest");
});

it("enforces the UTF-8 byte cap at the exact file boundary and refuses one byte more", async () => {
  const f = await fixture(), overhead = Buffer.byteLength(JSON.stringify(receipt("")));
  const length = MAX_RECEIPT_INPUT_BYTES - overhead;
  const value = receipt("🧾".repeat(Math.floor(length / 4)) + "a".repeat(length % 4));
  const raw = JSON.stringify(value); expect(Buffer.byteLength(raw)).toBe(MAX_RECEIPT_INPUT_BYTES);
  await writeFile(f.file, raw);
  expect((await verifyReceiptCli([f.file])).exitCode).toBe(0);
  await writeFile(f.file, raw + " ");
  expect(await verifyReceiptCli([f.file])).toMatchObject({ exitCode: 1, stdout: "", stderr: "INVALID — receipt-input-too-large\n" });
});

it("cancels an oversized HTTP body even if content-length claims it is small", async () => {
  const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(MAX_RECEIPT_INPUT_BYTES + 1)); }, cancel,
  });
  const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { "content-length": "1" } }));
  const result = await verifyReceiptCli(["https://keryx.cc/receipt"], { fetch: http });
  expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: "INVALID — receipt-input-too-large\n" });
  expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
});

it("uses its 30-second deadline for the entire real HTTP body without echoing private abort details", async () => {
  const controller = new AbortController(), deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" }); res.write('{"private":"');
  });
  servers.push(server); await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); if (!address || typeof address === "string") throw new Error();
  let receivedHeaders = false;
  const http: typeof fetch = async (input, init) => {
    const response = await fetch(input, init); receivedHeaders = true;
    setImmediate(() => controller.abort(new Error("PRIVATE_ABORT_DETAILS")));
    return response;
  };
  const result = await verifyReceiptCli([`http://127.0.0.1:${address.port}/receipt`], { fetch: http });
  expect(receivedHeaders).toBe(true);
  expect(deadline).toHaveBeenCalledWith(30_000);
  expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "INVALID — receipt-request-aborted\n" });
});

it("rejects malformed flags before HTTP I/O and keeps paths/credentials out of errors", async () => {
  const http = vi.fn<typeof fetch>();
  expect((await verifyReceiptCli(["https://keryx.cc/receipt", "--expect"], { fetch: http })).exitCode).toBe(2);
  const f = await fixture(), missing = join(f.directory, "PRIVATE_PATH_TOKEN");
  const unavailable = await verifyReceiptCli([missing]);
  expect(unavailable.exitCode).toBe(1); expect(unavailable.stderr).not.toContain(missing);
  const credentials = await verifyReceiptCli(["https://user:PRIVATE_PASSWORD@keryx.cc/receipt"], { fetch: http });
  expect(credentials.exitCode).toBe(1); expect(credentials.stderr).not.toContain("PRIVATE_PASSWORD");
  expect(http).not.toHaveBeenCalled();
  expect((await verifyReceiptCli(["--help"])).exitCode).toBe(0);
  expect((await verifyReceiptCli([f.file, "--expect", `sha256:${"0".repeat(64)}`])).exitCode).toBe(1);
});

it.runIf(process.platform !== "win32")("refuses a FIFO without waiting for a writer", async () => {
  const f = await fixture(), fifo = join(f.directory, "receipt.fifo");
  await promisify(execFile)("mkfifo", [fifo]);
  expect(await verifyReceiptCli([fifo])).toMatchObject({ exitCode: 1, stdout: "" });
});
