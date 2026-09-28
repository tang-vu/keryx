import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";

const dist = join(import.meta.dirname, "dist");
await mkdir(dist, { recursive: true });
await build({ entryPoints: ["src/main.ts"], absWorkingDir: import.meta.dirname,
  bundle: true, platform: "node", target: "node22", format: "cjs", external: ["electron"],
  outfile: "dist/main.cjs", logLevel: "info" });
await build({ entryPoints: ["src/preload.ts"], absWorkingDir: import.meta.dirname,
  bundle: true, platform: "node", target: "node22", format: "cjs", external: ["electron"],
  outfile: "dist/preload.cjs", logLevel: "info" });
await build({ entryPoints: ["src/renderer.tsx"], absWorkingDir: import.meta.dirname,
  bundle: true, platform: "browser", target: "chrome130", format: "iife", minify: true,
  outfile: "dist/renderer.js", logLevel: "info" });
await copyFile(join(import.meta.dirname, "src/index.html"), join(dist, "index.html"));
await copyFile(join(import.meta.dirname, "src/style.css"), join(dist, "style.css"));
