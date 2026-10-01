/** Synthetic loopback TLS bridge to the evaluator's exact owned PostgREST
 * network namespace. It never forwards to a configured application target. */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

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
    "storage_set_sync_state", "storage_get_sync_state", "storage_save_query_run"]);
  const timings = new Map<string, { started: number; completed: number; failed: number; totalMs: number; maxMs: number }>();
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
          const body: Buffer[] = [];
          let bytes = 0;
          request.setTimeout(5_000, () => request.destroy());
          for await (const part of request) {
            const chunk = Buffer.from(part);
            bytes += chunk.length;
            if (bytes > 4 * 1024 * 1024) throw new Error("Synthetic bridge request bound");
            body.push(chunk);
          }
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
            (error, stdout) => error ? reject(new Error("Synthetic bridge unavailable")) : resolveOutput(stdout));
            child.stdin!.end(Buffer.concat(body));
          });
          const split = output.lastIndexOf(10);
          const status = Number(output.subarray(split + 1).toString("ascii"));
          if (split < 0 || !Number.isInteger(status) || status < 200 || status > 599) throw new Error();
          succeeded = status < 400;
          response.writeHead(status, { "Content-Type": "application/json" }).end(output.subarray(0, split));
        } catch {
          if (!response.headersSent) response.writeHead(503);
          response.end('{"code":"SYNTHETIC_UNAVAILABLE","message":"Synthetic bridge unavailable"}');
        } finally {
          if (diagnosticOperation) {
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
