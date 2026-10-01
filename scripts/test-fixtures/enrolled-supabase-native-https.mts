/** Synthetic loopback TLS bridge to the evaluator's exact owned PostgREST
 * network namespace. It never forwards to a configured application target. */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import type { IncomingMessage } from "node:http";

/** Test-only request phase bound. Response work retains its separate deadlines. */
export async function readOwnedFixtureRequestBody(request: IncomingMessage, bodyTimeoutMs = 5_000) {
  assert(Number.isSafeInteger(bodyTimeoutMs) && bodyTimeoutMs > 0 && bodyTimeoutMs <= 5_000);
  const body: Buffer[] = [];
  let bytes = 0;
  request.setTimeout(bodyTimeoutMs, () => request.destroy());
  for await (const part of request) {
    const chunk = Buffer.from(part);
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) throw new Error("Synthetic bridge request bound");
    body.push(chunk);
  }
  // IncomingMessage.setTimeout installs a socket timer: leaving it active also
  // kills a fully received request while SQL response work is still running.
  request.setTimeout(0);
  return Buffer.concat(body);
}

export async function startOwnedSupabaseHttpsBridge(curlContainer: string) {
  assert(/^keryx-enrolled-reference-[a-f0-9-]+-curl$/.test(curlContainer));
  const directory = mkdtempSync(join(tmpdir(), "keryx-enrolled-tls-"));
  const certificate = join(directory, "synthetic-ca.pem");
  const key = join(directory, "synthetic-key.pem");
  const pending = new Set<Promise<void>>();
  const counts = new Map<string, number>();
  const diagnosticOperations = new Set(["read_storage_identity", "storage_inspect_runtime_readiness",
    "storage_verify_runtime_authority", "storage_upsert_source", "storage_get_source",
    "storage_set_cached", "storage_get_cached", "storage_create_auth_challenge",
    "storage_consume_auth_challenge", "storage_upsert_user", "storage_get_user",
    "storage_set_sync_state", "storage_get_sync_state", "storage_save_query_run",
    "storage_scan_payment_metrics", "storage_scan_query_metrics", "storage_scan_feedback_metrics",
    "storage_scan_gap_metrics", "storage_get_query_run", "storage_list_recent_queries",
    "storage_get_item", "storage_read_browser_source_catalog", "storage_activate_browser_journal", "storage_upsert_browser_journal_grant",
    "storage_browser_signing_admit_query", "storage_browser_signing_replay_source_original",
    "storage_browser_signing_admit_source_original"]);
  const timings = new Map<string, { started: number; completed: number; failed: number; totalMs: number; maxMs: number }>();
  const failures = new Map<string, number>();
  const metricShapes = new Map<string, { shape: "array" | "null" | "object" | "scalar" | "invalid"; length: number | null }>();
  const metricOperations = new Set(["storage_scan_payment_metrics", "storage_scan_query_metrics",
    "storage_scan_feedback_metrics", "storage_scan_gap_metrics"]);
  let closed = false;
  const server = createServer();
  try {
    // Only generated ephemeral fixture credentials, never application keys.
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", key, "-out", certificate, "-days", "1", "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-addext", "basicConstraints=critical,CA:TRUE"], { timeout: 10_000, stdio: "ignore" });
    server.setSecureContext({ key: readFileSync(key), cert: readFileSync(certificate) });
    server.on("request", (request, response) => {
      const work = (async () => {
        let diagnosticOperation: string | undefined;
        let startedAt = 0;
        let succeeded = false;
        let failureCategory = "transport-refused";
        try {
          const path = request.url ?? "";
          if (closed || request.method !== "POST" ||
            !/^\/rest\/v1\/rpc\/(read_storage_identity|storage_[a-z0-9_]+)$/.test(path) ||
            Buffer.byteLength(JSON.stringify(request.headers)) > 8192 || pending.size >= 8) {
            response.writeHead(400).end(); return;
          }
          const authorization = request.headers.authorization;
          if (typeof authorization !== "string" || !/^Bearer [A-Za-z0-9_.-]{1,2048}$/.test(authorization)) {
            response.writeHead(401).end(); return;
          }
          const body = await readOwnedFixtureRequestBody(request);
          const operation = path.slice("/rest/v1/rpc/".length);
          diagnosticOperation = diagnosticOperations.has(operation) ? operation : "other";
          startedAt = performance.now();
          const current = timings.get(diagnosticOperation) ?? { started: 0, completed: 0, failed: 0, totalMs: 0, maxMs: 0 };
          timings.set(diagnosticOperation, { ...current, started: current.started + 1 });
          counts.set(operation, (counts.get(operation) ?? 0) + 1);
          const output = await new Promise<Buffer>((resolveOutput, reject) => {
            const child = execFile("docker", ["exec", "-i", curlContainer,
              "curl", "--max-time", "15", "--silent", "--show-error", "--request", "POST",
              "--header", "Content-Type: application/json", "--header", authorization.replace(/^Bearer /, "Authorization: Bearer "),
              "--data-binary", "@-", "--write-out", "\n%{http_code}",
              `http://127.0.0.1:3000${path.slice("/rest/v1".length)}`],
            { timeout: 20_000, maxBuffer: 11 * 1024 * 1024, encoding: "buffer" },
            (error, stdout) => {
              if (!error) { resolveOutput(stdout); return; }
              failureCategory = error.killed ? "process-deadline"
                : typeof error.code === "number" && Number.isInteger(error.code) && error.code >= 0 && error.code <= 255
                  ? `process-exit-${error.code}` : "process-unavailable";
              reject(new Error("Synthetic bridge unavailable"));
            });
            child.stdin!.end(body);
          });
          const split = output.lastIndexOf(10);
          const status = Number(output.subarray(split + 1).toString("ascii"));
          if (split < 0 || !Number.isInteger(status) || status < 200 || status > 599) throw new Error();
          succeeded = status < 400;
          if (succeeded && metricOperations.has(operation)) {
            try {
              const parsed: unknown = JSON.parse(output.subarray(0, split).toString("utf8"));
              metricShapes.set(operation, { shape: Array.isArray(parsed) ? "array" : parsed === null ? "null"
                : typeof parsed === "object" ? "object" : "scalar",
              length: Array.isArray(parsed) ? Math.min(parsed.length, 1001) : null });
            } catch { metricShapes.set(operation, { shape: "invalid", length: null }); }
          }
          if (!succeeded) {
            failureCategory = `http-${status}`;
            try {
              const parsed: unknown = JSON.parse(output.subarray(0, split).toString("utf8"));
              if (parsed && typeof parsed === "object" && "code" in parsed && typeof parsed.code === "string" &&
                /^[0-9A-Z]{5}$/.test(parsed.code)) failureCategory += `-sqlstate-${parsed.code}`;
              if (operation === "storage_browser_signing_admit_source_original" && parsed && typeof parsed === "object" &&
                "code" in parsed && parsed.code === "P0001" && "message" in parsed) {
                const sourceRefusals = new Map<unknown, string>([
                  ["browser source observation expired", "observation-expired"],
                  ["browser source context refused", "context-refused"],
                  ["browser source list price refused", "list-price-refused"],
                  ["browser source offer refused", "offer-refused"],
                  ["browser source price mode refused", "price-mode-refused"],
                  ["browser source endpoint refused", "endpoint-refused"],
                  ["browser signing journal differs", "journal-differs"],
                  ["browser signing original differs", "original-differs"],
                  ["browser signing original refused", "original-refused"],
                  ["browser signing original conflict", "original-conflict"],
                ]);
                failureCategory += `-source-${sourceRefusals.get(parsed.message) ?? "unclassified"}`;
              }
            } catch { /* Never retain provider error messages or response bodies. */ }
          }
          response.writeHead(status, { "Content-Type": "application/json" }).end(output.subarray(0, split));
        } catch {
          if (!response.headersSent) response.writeHead(503);
          response.end('{"code":"SYNTHETIC_UNAVAILABLE","message":"Synthetic bridge unavailable"}');
        } finally {
          if (diagnosticOperation) {
            if (!succeeded) {
              // Strict codes only; a fixed cap prevents diagnostic-cardinality growth.
              const key = `${diagnosticOperation}:${failureCategory}`;
              const boundedKey = failures.has(key) || failures.size < 32 ? key : "other:diagnostic-cap";
              failures.set(boundedKey, (failures.get(boundedKey) ?? 0) + 1);
            }
            const elapsed = Math.ceil(performance.now() - startedAt);
            const previous = timings.get(diagnosticOperation)!;
            timings.set(diagnosticOperation, { started: previous.started, completed: previous.completed + 1,
              failed: previous.failed + (succeeded ? 0 : 1), totalMs: previous.totalMs + elapsed,
              maxMs: Math.max(previous.maxMs, elapsed) });
          }
        }
      })();
      pending.add(work);
      void work.finally(() => pending.delete(work));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    return {
      origin: `https://127.0.0.1:${address.port}`,
      certificate: resolve(certificate),
      counts,
      timings,
      failures,
      metricShapes,
      close: async () => {
        closed = true;
        server.closeAllConnections();
        await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
        await Promise.allSettled([...pending]);
        rmSync(directory, { recursive: true });
      },
    };
  } catch (error) {
    closed = true;
    server.closeAllConnections();
    server.close();
    rmSync(directory, { recursive: true });
    throw error;
  }
}
