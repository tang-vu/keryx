import { parseArgs } from "node:util";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";

async function main() {
  const { values } = parseArgs({ options: { help: { type: "boolean" }, locator: { type: "string" }, apply: { type: "boolean" } },
    strict: true, allowPositionals: false });
  if (values.help) {
    console.log("Usage: node --import tsx scripts/private-interruption.mts --locator /absolute/private-locator.json [--apply]\nStop the managed worker and inspect any retained crash lock first. Load the actual database and spool environment explicitly. Default inspects only. Apply restores a matching backup first; otherwise records interruption and releases only never-committed budget. Never signs, pays, refunds, reruns research or removes crash locks. Locator JSON contains id and payer; keep it private.");
    return;
  }
  if (!values.locator || !isAbsolute(values.locator)) throw new Error();
  const handle = await open(values.locator, "r");
  let locator: unknown;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 2 || stat.size > 1024) throw new Error();
    const bytes = Buffer.alloc(1025), read = await handle.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead > 1024) throw new Error();
    locator = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, read.bytesRead)).replace(/^\uFEFF/, ""));
  } finally { await handle.close(); }
  const directory = process.env.KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY, keyHex = process.env.KERYX_PRIVATE_RESULT_SPOOL_KEY;
  if (!directory || !keyHex) throw new Error();
  const { getDb } = await import("../lib/db");
  const { resolvePrivateInterruption } = await import("../lib/a2a/private-interruption-operator");
  const db = await getDb();
  try { console.log(JSON.stringify(await resolvePrivateInterruption(db, locator, { directory, keyHex, apply: values.apply === true }))); }
  finally { (db as { close?: () => void }).close?.(); }
}
main().catch(() => { console.error("Private interruption unavailable. Inspect the original job, stopped worker, actual spool/key and retained backups. Private details omitted."); process.exitCode = 1; });
