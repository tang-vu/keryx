import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { patchLegacyZod } from "../scripts/patch-legacy-zod.mjs";

const root = dirname(fileURLToPath(import.meta.url));
patchLegacyZod(resolve(root, ".."));
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const circleEntry = fileURLToPath(import.meta.resolve("@circle-fin/x402-batching/client"));
const circleRoot = resolve(dirname(circleEntry), "../..");
const circleVersion = JSON.parse(await readFile(resolve(circleRoot, "package.json"), "utf8")).version;
if (circleVersion !== manifest.devDependencies["@circle-fin/x402-batching"]) throw new Error("Pinned Circle SDK version mismatch");
const result = await build({
  absWorkingDir: root, entryPoints: ["keryx-mcp-server.mts"],
  bundle: true, platform: "node", format: "esm", target: "node22",
  // Bundle the pinned Circle client so npm consumers do not install its
  // auto-installed x402 peer graph with an unpatched Zod 3 dependency.
  external: Object.keys(manifest.dependencies).filter(name => name !== "zod").flatMap(name => [name, `${name}/*`]),
  plugins: [{ name: "bounded-legacy-zod", setup(api) {
    api.onResolve({ filter: /^zod(?:\/v3)?$/ }, () => ({ path: resolve(root, "../node_modules/zod/v3/index.js") }));
  } }],
  outfile: "dist/keryx-mcp.mjs", metafile: true, legalComments: "eof",
  banner: { js: "// Includes Circle buyer 3.5.0 (Apache-2.0) and modified Zod v3 compatibility runtime (MIT), with over-limit array security backport. See THIRD-PARTY-NOTICES.txt." },
});
const bundled = Object.keys(result.metafile.inputs).filter(name => name.includes("node_modules/"));
if (bundled.some(name => !name.includes("node_modules/@circle-fin/x402-batching/") && !name.includes("node_modules/zod/v3/"))) {
  throw new Error(`Review newly bundled third-party modules: ${bundled.join(", ")}`);
}
await writeFile(resolve(root, "dist/build-inputs.json"), JSON.stringify({ bundled,
  bundleSha256: createHash("sha256").update(await readFile(resolve(root, "dist/keryx-mcp.mjs"))).digest("hex"),
  circle: { version: circleVersion, sourceSha256: createHash("sha256").update(await readFile(circleEntry)).digest("hex") },
  validation: { packageVersion: "4.6.7", runtime: "v3", patch: "CVE-2023-54404-pre-traversal-refusal" },
  inputDigests: await Promise.all(bundled.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(resolve(root, path))).digest("hex") }))),
}, null, 2) + "\n");
