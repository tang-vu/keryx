#!/usr/bin/env node
import { runPrivateJobHistoryCli } from "../lib/history/private-job-history-cli.ts";

process.exitCode = await runPrivateJobHistoryCli(process.argv.slice(2), {
  key: () => process.env.KERYX_API_KEY,
  write: text => { process.stdout.write(text); },
  error: text => { process.stderr.write(text); },
});
