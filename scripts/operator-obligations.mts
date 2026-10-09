/** Hosted delegated inspection only; no env-file loader, wallet, DB or provider. */
import { createObligationClient } from "../lib/operator-obligations/client.ts";

const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log("Usage: npm run operator:obligations -- [read]\nRequires KERYX_OPERATOR_URL (HTTPS origin) and an operator:read KERYX_API_KEY for the server-delegated reader. No treasury action.");
} else {
  if (args.length > 1 || args[0] && args[0] !== "read") throw new Error("Use operator:obligations -- [read]");
  console.log(JSON.stringify(await createObligationClient(process.env.KERYX_OPERATOR_URL ?? "https://keryx.cc", () => process.env.KERYX_API_KEY).read(), null, 2));
}
