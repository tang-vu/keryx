/** Verify the SHA-256 integrity block on a downloaded Keryx research receipt. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyResearchReceipt } from "../lib/research-receipt";

const args = process.argv.slice(2);
let target = "";
let expectedDigest = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--expect") {
    expectedDigest = args[++i] ?? "";
  } else if (!target) {
    target = args[i] ?? "";
  }
}
if (!target) {
  console.error(
    "Usage: npm run verify:receipt -- <receipt.json|https://keryx.cc/api/dispatch/.../receipt> [--expect sha256:...]",
  );
  process.exit(2);
}
if (expectedDigest && !/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) {
  console.error("INVALID — --expect must be a sha256:<64 lowercase hex> digest");
  process.exit(2);
}

async function load(value: string): Promise<{
  receipt: unknown;
  responseDigest?: string;
  secureResponse?: boolean;
}> {
  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`receipt request failed (${response.status})`);
    return {
      receipt: await response.json(),
      secureResponse: new URL(response.url).protocol === "https:",
      ...(response.headers.get("x-keryx-receipt-digest")
        ? { responseDigest: response.headers.get("x-keryx-receipt-digest")! }
        : {}),
    };
  }
  return { receipt: JSON.parse(await readFile(resolve(value), "utf8")) };
}

try {
  const { receipt, responseDigest, secureResponse } = await load(target);
  const result = verifyResearchReceipt(receipt);
  if (!result.valid) {
    console.error(`INVALID — ${result.reason ?? "receipt verification failed"}`);
    if (result.actualDigest) console.error(`  receipt: ${result.actualDigest}`);
    if (result.expectedDigest) console.error(`  computed: ${result.expectedDigest}`);
    process.exit(1);
  }
  if (responseDigest && responseDigest !== result.actualDigest) {
    console.error("INVALID — response header digest does not match the receipt");
    process.exit(1);
  }
  if (expectedDigest && expectedDigest !== result.actualDigest) {
    console.error(`INVALID — receipt does not match retained digest ${expectedDigest}`);
    process.exit(1);
  }
  console.log(`VALID — ${result.actualDigest}`);
  if (responseDigest) {
    console.log(
      `Matched X-Keryx-Receipt-Digest from the ${secureResponse ? "HTTPS" : "HTTP"} response`,
    );
  }
  if (expectedDigest) console.log("Matched the separately retained expected digest");
  console.log(
    "Integrity scope: exported payload; authenticity requires the HTTPS origin or a separately retained digest",
  );
  if (responseDigest && secureResponse === false && !expectedDigest) {
    console.log("Warning: HTTP does not authenticate the response origin; retain/compare the digest separately");
  }
} catch (error) {
  console.error(`INVALID — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
