import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";

// No environment files, runtime bootstrap, target discovery or signer dependency.
const started = performance.now();
try {
  const { values, tokens } = parseArgs({ options: { help: { type: "boolean" }, "storage-manifest": { type: "string" }, "operation-manifest": { type: "string" }, "current-availability": { type: "boolean" } }, strict: true, allowPositionals: false, tokens: true });
  const seen = new Set<string>(); for (const token of tokens) { if (token.kind === "option") { if (seen.has(token.name)) throw new Error(); seen.add(token.name); } }
  if (values.help) process.stdout.write("Usage: npm run funding:inspect -- --storage-manifest <absolute-canonical-file> --operation-manifest <absolute-canonical-file> [--current-availability]\nReadonly original-state inspection; current Circle availability is opt-in, never credit attribution or signing permission.\n");
  else {
    if (!values["storage-manifest"] || !values["operation-manifest"]) throw new Error();
    const request = JSON.stringify({ storageManifestPath: values["storage-manifest"], operationManifestPath: values["operation-manifest"], currentAvailability: values["current-availability"] ?? false });
    if (Buffer.byteLength(request) > 8192 || performance.now() - started >= 30000) throw new Error();
    const require = createRequire(import.meta.url), child = spawn(process.execPath, ["--max-old-space-size=128", "--import", pathToFileURL(require.resolve("tsx")).href,
      fileURLToPath(new URL("./funding-inspect-child.mts", import.meta.url))], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
      env: process.platform === "win32" ? { NODE_ENV: "production", SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : { NODE_ENV: "production" } });
    const output = await new Promise<string>((resolve, reject) => {
      let wire = "", failed = false;
      const timer = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, Math.max(1, 30000 - (performance.now() - started)));
      child.stdout.on("data", (chunk: Buffer) => { if (Buffer.byteLength(wire) + chunk.length > 8192) { failed = true; child.kill("SIGKILL"); } else wire += chunk.toString("utf8"); });
      child.once("error", () => { failed = true; }); child.stdin.once("error", () => { failed = true; });
      child.once("close", code => { clearTimeout(timer); if (failed || code !== 0 || performance.now() - started >= 30000) reject(new Error()); else resolve(wire); });
      child.stdin.end(request);
    });
    const report = JSON.parse(output);
    if (report.format !== "keryx-funding-inspection-report-v1" || report.status !== "inspected-originals" || report.readOnly !== true || report.signingResumeAuthorized !== false || JSON.stringify(report) !== output) throw new Error();
    if (Buffer.byteLength(output) + 1 > 8192) throw new Error(); process.stdout.write(output + "\n");
  }
} catch { process.stderr.write("Funding inspection unavailable; private details omitted\n"); process.exitCode = 1; }
