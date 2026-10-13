import { runOwnedHistoryCli } from "../lib/history/owned-history-cli.ts";

process.exitCode = await runOwnedHistoryCli(process.argv.slice(2), {
  key: process.env.KERYX_API_KEY,
  baseUrl: process.env.KERYX_BASE_URL,
  write: text => { process.stdout.write(text); },
  error: text => { process.stderr.write(text); },
});
