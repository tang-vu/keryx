/** Owner-key customer requests only. No environment-file loader, signer, dispatch or refund. */
import { readAcceptanceInputFile } from "../lib/deliverable-acceptance/input-file.ts";
import { createAcceptanceClient } from "../lib/deliverable-acceptance/client.ts";

const args = process.argv.slice(2), [action, id, file] = args;
if (!id || !["read", "submit"].includes(action) || args.length !== (action === "submit" ? 3 : 2))
  throw new Error("Usage: npm run deliverable:acceptance -- read <a2a_id> | submit <a2a_id> <submission.json>. Submission needs exact read-back digests/revision and a retained idempotencyKey; no automatic retry.");
const client = createAcceptanceClient(process.env.KERYX_BASE_URL ?? "https://keryx.cc", () => process.env.KERYX_API_KEY);
let result;
if (action === "read") result = await client.read(id);
else result = await client.submit(id, readAcceptanceInputFile(file));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
