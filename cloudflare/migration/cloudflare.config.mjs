import { bindings, defineConfig } from "cf/config";

const catalogGeneration = process.env.KERYX_CATALOG_GENERATION ?? "synthetic-catalog-v1";
const catalogDatabase = process.env.KERYX_CATALOG_DB_ID;
if (!/^(synthetic-catalog-v1|vps-public-[a-f0-9]{64})$/.test(catalogGeneration)) throw new Error("Invalid private catalog generation");
if (catalogDatabase && !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(catalogDatabase)) throw new Error("Invalid private catalog database ID");

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
      CATALOG_DB: bindings.d1({ name: "keryx-migration-catalog", ...(catalogDatabase ? { id: catalogDatabase } : {}) }),
      CATALOG_BLOBS: bindings.r2({ name: "keryx-migration-catalog" }),
      CATALOG_GENERATION: bindings.text(catalogGeneration),
      KERYX_NETWORK: bindings.text("arcTestnet"),
      NEXT_PUBLIC_KERYX_NETWORK: bindings.text("arcTestnet"),
      KERYX_FORCE_OFFLINE: bindings.text("1"),
    },
  },
});
