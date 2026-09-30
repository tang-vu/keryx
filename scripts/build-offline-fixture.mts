import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { offlineRuntimeFixture } from "./offline-runtime-fixture.ts";

// Build-only explicit fresh offline storage. No real enrollment, key loading, or production store initialization.
let fixture: Awaited<ReturnType<typeof offlineRuntimeFixture>> | undefined;
try {
  fixture = await offlineRuntimeFixture(process.env);
  const require = createRequire(import.meta.url);
  const env = fixture.env;
  const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "build", ...process.argv.slice(2)],
    { env, stdio: "inherit", windowsHide: true });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject); child.once("close", code => resolve(code ?? 1));
    });
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
} catch { console.error("Isolated offline build unavailable; production storage untouched"); process.exitCode = 1; }
finally { await fixture?.close(); }
