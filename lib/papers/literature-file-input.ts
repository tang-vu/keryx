import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { MAX_LITERATURE_BYTES } from "./literature-workspace";

/** Explicit CLI file only; validate the opened descriptor and bound read growth. */
export async function readLiteratureFile(path: string, limit: number): Promise<string> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LITERATURE_BYTES) throw new Error("input");
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error("input");
    const bytes = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > limit) throw new Error("input");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset));
  } finally { await file.close(); }
}
