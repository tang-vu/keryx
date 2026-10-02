import { defineConfig, bindings, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "keryx-source-upkeep",
    compatibilityDate: "2026-09-30",
    entrypoint: "./src/index.ts",
    workersDev: false,
    previewUrls: false,
    env: { SOURCE_UPKEEP_TOKEN: bindings.secret() },
    triggers: [triggers.scheduled({ schedule: "7 * * * *" })],
  },
});
