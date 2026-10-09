import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { acceptanceInputSchema } from "./contracts";
/** One opened regular file, max+1 bytes, no stream/device reads or unbounded allocation. */
export function readAcceptanceInputFile(file: string) {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor), limit = 16384;
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size > limit) throw new Error();
    const bytes = new Uint8Array(limit + 1); let count = 0;
    for (;;) { const read = readSync(descriptor, bytes, count, bytes.length - count, null); if (!read) break;
      count += read; if (count > limit) throw new Error(); }
    return acceptanceInputSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count))));
  } catch { throw new Error("Acceptance submission requires a regular UTF-8 JSON file of at most 16 KiB with the closed input schema."); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}
