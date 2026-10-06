/** Read-only public observation. Does not load secrets or create a scheduler. */
import { operatorBusinessStatusSchema } from "../lib/business-operator/contracts.ts";
import { readBoundedJson } from "../lib/read-bounded-json.ts";
const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log("Usage: npm run operator:business -- [status]\nRead-only public business observation. No wallet, funding, execution or scheduler. KERYX_OPERATOR_URL selects the hosted origin.");
  process.exit(0);
}
if (args.length > 1 || args[0] && args[0] !== "status") throw new Error("Usage: npm run operator:business -- [status]");
const url = new URL("/api/operator/status", process.env.KERYX_OPERATOR_URL ?? "https://keryx.cc");
if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
  url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Operator URL refused");
const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store" });
if (!response.ok) throw new Error("Operator observation unavailable");
console.log(JSON.stringify(operatorBusinessStatusSchema.parse(await readBoundedJson(response)), null, 2));
