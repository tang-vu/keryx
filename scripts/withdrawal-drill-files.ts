import fs from "node:fs";
import path from "node:path";

/** Durable, exclusive original/attempt marker. Existing bytes always win. */
export function saveWithdrawalDrillExclusive(file: string, data: unknown) {
  const descriptor = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify(data)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  if (process.platform === "linux") {
    const folder = fs.openSync(path.dirname(file), "r");
    try { fs.fsyncSync(folder); } finally { fs.closeSync(folder); }
  }
}
