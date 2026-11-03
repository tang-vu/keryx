import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig, loadConfigFromFile, type Plugin } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import vinext, { type VinextOptions } from "vinext";
import { patchMetadataAlternates } from "./src/metadata-compat.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const previewRoot = fileURLToPath(new URL("./", import.meta.url));
const require = createRequire(import.meta.url);
const applicationRequire = createRequire(new URL("../../package.json", import.meta.url));
const tailwindPostcss = applicationRequire("@tailwindcss/postcss");
const rewriteCircleBrowser = require("../../scripts/circle-sdk-browser-loader.cjs") as
  (this: { resourcePath: string }, source: string) => string;
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
// Bundle the existing mixed TS/CJS config so its named CJS security-header
// exports retain their actual values. Do not reimplement or discard those rules.
const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, `${root}next.config.ts`, root);
if (!loaded) throw new Error("Canonical application configuration unavailable");
const nextConfig = loaded.config as unknown as NonNullable<VinextOptions["nextConfig"]>;

// Preserve the exact pinned browser-only nonce decoder; never rewrite the server SDK.
const circleBrowser: Plugin = {
  name: "keryx-circle-browser-decoder", enforce: "pre",
  transform(source, id) {
    if (this.environment.name !== "client" ||
      !/node_modules\/@circle-fin\/w3s-pw-web-sdk\/dist\/src\/index\.js$/.test(id.replaceAll("\\", "/"))) return;
    return rewriteCircleBrowser.call({ resourcePath: id }, source);
  },
};
const metadataCompatibility: Plugin = {
  name: "keryx-metadata-alternate-descriptors", enforce: "pre",
  transform(source, id) {
    if (id.replaceAll("\\", "/").endsWith("/vinext/dist/shims/metadata.js")) {
      return patchMetadataAlternates(source);
    }
  },
};
const stylesheetCompatibility: Plugin = {
  name: "keryx-shared-stylesheets", enforce: "pre",
  transform(source, id) {
    if (id.replaceAll("\\", "/").split("?")[0] === `${root}app/layout.tsx`.replaceAll("\\", "/")) {
      // Preserve these authored styles as explicit CSS dependencies. Vite's
      // RSC/Tailwind pipeline drops their late nested imports in globals.css.
      return `import ${JSON.stringify(`${root}shared/design-tokens.css`)};\n` +
        `import ${JSON.stringify(`${root}app/fonts/vietnamese.css`)};\n${source}`;
    }
  },
};

export default defineConfig({
  root: previewRoot,
  envDir: previewRoot,
  publicDir: `${root}public`,
  css: { postcss: { plugins: [tailwindPostcss()] } },
  resolve: { dedupe: ["react", "react-dom", "react-server-dom-webpack"], alias: [
    { find: "@", replacement: root.replace(/\/$/, "") },
  ] },
  define: {
    __KERYX_SOURCE_COMMIT__: JSON.stringify(sourceCommit),
    "process.env.KERYX_NETWORK": JSON.stringify("arcTestnet"),
    "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify("arcTestnet"),
    "process.env.KERYX_FORCE_OFFLINE": JSON.stringify("1"),
    "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(""),
    "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(""),
  },
  plugins: [circleBrowser, metadataCompatibility, stylesheetCompatibility, vinext({ appDir: root, nextConfig }), cloudflare({
    viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    persistState: { path: fileURLToPath(new URL("./.cloudflare/state", import.meta.url)) },
  })],
});
