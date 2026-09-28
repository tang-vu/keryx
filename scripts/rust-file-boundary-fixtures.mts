import { readFile, writeFile } from "node:fs/promises";

/** Pad an existing synthetic JSON fixture to an exact UTF-8 byte length. */
export async function padJsonFileToByteLength(path: string, targetBytes: number): Promise<void> {
  const original = await readFile(path);
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(original));
  if (!Number.isSafeInteger(targetBytes) || targetBytes < original.length) {
    throw new Error(`Cannot pad JSON fixture of ${original.length} bytes to ${targetBytes}`);
  }
  await writeFile(path, Buffer.concat([original, Buffer.alloc(targetBytes - original.length, 0x20)]));
}
