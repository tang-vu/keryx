/** Copy the canonical browser-safe formatter; --check verifies the committed distribution copy. */
import { readFile, writeFile } from "node:fs/promises";

if (process.argv.slice(2).some(argument => argument !== "--check")) throw new Error("Only --check is supported");
const source = await readFile(new URL("../lib/display/recorded-usdc.mjs", import.meta.url));
const target = new URL("../extension/recorded-usdc.mjs", import.meta.url);
if (process.argv.includes("--check")) {
  if (!source.equals(await readFile(target))) throw new Error("Extension formatter differs from its canonical source");
} else {
  await writeFile(target, source);
}
