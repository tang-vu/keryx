import { fileURLToPath } from "node:url";
import path from "node:path";

export const requiredJobs = ["checks", "unit-tests", "integration", "browser-source", "production"];

export function assertCiGate(scope, results) {
  if (!["docs", "full"].includes(scope)) throw new Error("Missing CI scope");
  if (results?.scope?.result !== "success") throw new Error("CI scope job did not succeed");
  for (const name of requiredJobs) {
    const expected = scope === "full" || name === "checks" ? "success" : "skipped";
    if (results[name]?.result !== expected) throw new Error(`${name}: expected ${expected}, received ${results[name]?.result ?? "missing"}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertCiGate(process.env.CI_SCOPE, JSON.parse(process.env.CI_RESULTS ?? "null"));
  console.log("All applicable CI gates passed");
}
