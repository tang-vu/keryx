#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exportLiteratureCli, usage } from "../lib/papers/literature-export-cli";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await exportLiteratureCli(process.argv.slice(2)); if (result !== null) process.stdout.write(result); }
  catch (error) {
    process.stderr.write(`Literature export refused (${error instanceof Error && error.message === "usage" ? "usage" : "invalid-backup-or-file-unavailable"}). No source lookup, research or purchase started.\n${usage}\n`);
    process.exitCode = 1;
  }
}
