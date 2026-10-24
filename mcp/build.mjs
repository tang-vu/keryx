import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const root = dirname(fileURLToPath(import.meta.url));
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
  external: Object.keys(manifest.dependencies).flatMap(name => [name, `${name}/*`]),
  outfile: "dist/keryx-mcp.mjs", metafile: true, legalComments: "eof",
  banner: { js: "// Includes @circle-fin/x402-batching 3.5.0 (Apache-2.0). See packaged THIRD-PARTY-NOTICES.txt." },
});
const bundled = Object.keys(result.metafile.inputs).filter(name => name.includes("node_modules/"));
if (bundled.some(name => !name.includes("node_modules/@circle-fin/x402-batching/"))) {
  throw new Error(`Review newly bundled third-party modules: ${bundled.join(", ")}`);
}
await writeFile(resolve(root, "dist/build-inputs.json"), JSON.stringify({ bundled,
  circle: { version: circleVersion, sourceSha256: createHash("sha256").update(await readFile(circleEntry)).digest("hex") },
}, null, 2) + "\n");
