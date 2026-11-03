import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "keryx-migration-preview",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-10-23",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: true,
    previewUrls: false,
    assets: { htmlHandling: "none", notFoundHandling: "none", runWorkerFirst: ["/*"] },
    env: {
      ASSETS: bindings.assets(),
      MIGRATION_PREVIEW_TOKEN: bindings.secret(),
      CATALOG_DB: bindings.d1({ name: "keryx-migration-catalog", ...(process.env.KERYX_CATALOG_DB_ID ? { id: process.env.KERYX_CATALOG_DB_ID } : {}) }),
      CATALOG_BLOBS: bindings.r2({ name: "keryx-migration-catalog" }),
      CATALOG_GENERATION: bindings.text("synthetic-catalog-v1"),
      KERYX_NETWORK: bindings.text("arcTestnet"),
      NEXT_PUBLIC_KERYX_NETWORK: bindings.text("arcTestnet"),
      KERYX_FORCE_OFFLINE: bindings.text("1"),
    },
  },
});
