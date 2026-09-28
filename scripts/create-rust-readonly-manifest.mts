/** Build-job tool: record an explicitly supplied source/target identity for a just-built binary. */
import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createNativeReadonlyManifest } from "../lib/operator/native-readonly-artifact.ts";

function options() {
  const args = process.argv.slice(2);
  const parsed = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    const value = args[i + 1];
    if (!["--binary", "--out", "--source-commit", "--target"].includes(name)
      || !value || parsed.has(name)) throw new Error("Expected --binary, --out, --source-commit and --target exactly once");
    parsed.set(name, value);
  }
  if (parsed.size !== 4) throw new Error("Expected --binary, --out, --source-commit and --target exactly once");
  return { binary: parsed.get("--binary")!, out: parsed.get("--out")!,
    sourceCommit: parsed.get("--source-commit")!, target: parsed.get("--target")! };
}

async function main() {
  const { binary, out, sourceCommit, target } = options();
  if (!isAbsolute(binary) || !isAbsolute(out)) throw new Error("Binary and manifest paths must be absolute");
  const manifest = await createNativeReadonlyManifest(binary, {
    sourceCommit, target: target as Parameters<typeof createNativeReadonlyManifest>[1]["target"],
  });
  await writeFile(out, `${JSON.stringify(manifest)}\n`, { flag: "wx", mode: 0o600 });
  console.log(`Native read-only manifest saved: ${out}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Native manifest creation failed");
  process.exitCode = 1;
});
