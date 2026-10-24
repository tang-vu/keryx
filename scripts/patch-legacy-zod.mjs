import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const hash = text => createHash("sha256").update(text).digest("hex");
const importNotice = "// Keryx: retain this native Zod 4 consumer on its explicit versioned runtime.\n";
const boundNotice = "// Keryx security backport: reject over-limit arrays before element traversal (CVE-2023-54404).\n";

export function boundLegacyArrays(source, commonjs) {
  const start = source.indexOf("class ZodArray");
  const end = source.indexOf("get element()", start);
  if (start < 0 || end < start) throw new Error("Unexpected ZodArray implementation");
  let count = 0;
  const invalid = commonjs ? "parseUtil_js_1.INVALID" : "INVALID";
  const body = source.slice(start, end).replaceAll("status.dirty();", () => {
    count++;
    if (count === 1) return `status.dirty();\n                if (tooBig) return ${invalid};`;
    if (count === 3) return `return ${invalid};`;
    return "status.dirty();";
  });
  if (count !== 3) throw new Error("Unexpected ZodArray bounds implementation");
  return boundNotice + source.slice(0, start) + body + source.slice(end);
}

/** Apply a reviewed security backport to Zod's published v3 compatibility
 * runtime. Keep legacy SDK APIs intact, with actual pre-traversal bounds.
 * Exact versions and before/after hashes refuse unknown bytes; verify the
 * complete cohort before writing. No new runtime dependency or audit waiver.
 */
export function patchLegacyZod(root) {
  const manifest = JSON.parse(readFileSync(join(scriptRoot, "legacy-zod-patches.json"), "utf8"));
  const writes = [];
  const packages = new Map();
  const verify = (filename, row, transform) => {
    const source = readFileSync(filename, "utf8");
    if (hash(source) === row.patchedSha256) return;
    if (hash(source) !== row.originalSha256) throw new Error(`Unexpected legacy validation bytes: ${row.package}/${row.path}`);
    const patched = transform(source);
    if (hash(patched) !== row.patchedSha256) throw new Error(`Legacy validation patch mismatch: ${row.package}/${row.path}`);
    writes.push([filename, patched]);
  };
  for (const row of [manifest.entry, ...manifest.runtime, ...manifest.imports]) {
    const packageRoot = join(resolve(root), "node_modules", row.package);
    if (!packages.has(packageRoot)) {
      packages.set(packageRoot, JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version);
    }
    if (packages.get(packageRoot) !== row.version) throw new Error(`Review legacy validation upgrade: ${row.package}`);
    verify(join(packageRoot, row.path), row, source => {
      if (row.path === "package.json") {
        const pkg = JSON.parse(source);
        pkg.main = "./v3/index.cjs"; pkg.module = "./v3/index.js"; pkg.types = "./v3/index.d.cts";
        pkg.exports["."] = { ...pkg.exports["./v3"] };
        pkg.keryxCompatibility = "Root retains the patched Zod 3 contract; explicit /v4 consumers retain native Zod 4.";
        return JSON.stringify(pkg, null, 2) + "\n";
      }
      if (row.package === "zod") return boundLegacyArrays(source, row.path.endsWith(".cjs"));
      let count = 0;
      const patched = source.replaceAll(/(\bfrom\s*|\brequire\(\s*)(['"])zod\2/g,
        (_, prefix, quote) => { count++; return `${prefix}${quote}zod/v4${quote}`; });
      if (count !== row.imports) throw new Error("Unexpected legacy Zod import count");
      return importNotice + patched;
    });
  }
  for (const [filename, source] of writes) writeFileSync(filename, source);
  return writes.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Legacy Zod security compatibility: ${patchLegacyZod(process.argv[2] ?? process.cwd())} verified files patched`);
}
