import { expect, it } from "vitest";
import { extractionWorker } from "./extraction-worker";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

it("loads all three workers from the same code cohort despite a decoy storage cwd", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-worker-cohort-"));
  for (const kind of ["html", "pdf", "bibliography"] as const) {
    const relative = path.relative(process.cwd(), extractionWorker(kind));
    fs.mkdirSync(path.dirname(path.join(scratch, relative)), { recursive: true });
    fs.writeFileSync(path.join(scratch, relative), "throw Error('Decoy worker executed');\n");
  }
  // A fresh process avoids changing Vitest's shared cwd or worker state.
  const helper = pathToFileURL(path.join(process.cwd(), "lib/web-research/extraction-worker.ts")).href;
  const loader = pathToFileURL(path.join(process.cwd(), "node_modules/tsx/dist/loader.mjs")).href;
  const result = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "-e",
    `import {extractionWorker} from ${JSON.stringify(helper)};
     console.log(JSON.stringify(['html','pdf','bibliography'].map(extractionWorker)));`],
    { cwd: scratch, env: { NODE_ENV: "test" }, encoding: "utf8", windowsHide: true });
  expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.signal).toBeNull();
  expect(JSON.parse(result.stdout)).toEqual(["html", "pdf", "bibliography"].map(kind => extractionWorker(kind as "html")));
  expect(() => extractionWorker("other" as "html")).toThrow("binding unavailable");
});

it("refuses a missing worker at the loaded package root without adopting an ancestor cohort", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-worker-missing-"));
  const nested = path.join(scratch, "candidate"), chunk = path.join(nested, ".next", "server", "chunks");
  fs.mkdirSync(chunk, { recursive: true });
  fs.writeFileSync(path.join(scratch, "package.json"), '{"name":"older-cohort"}');
  fs.writeFileSync(path.join(nested, "package.json"), '{"name":"candidate-cohort"}');
  fs.mkdirSync(path.join(scratch, "lib", "web-research"), { recursive: true });
  fs.writeFileSync(path.join(scratch, "lib", "web-research", "html-reader-worker.mjs"), "// ancestor must not be adopted\n");
  const helper = path.join(chunk, "extraction-worker.ts");
  fs.copyFileSync(path.join(process.cwd(), "lib/web-research/extraction-worker.ts"), helper);
  const loader = pathToFileURL(path.join(process.cwd(), "node_modules/tsx/dist/loader.mjs")).href;
  const result = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "-e",
    `import {extractionWorker} from ${JSON.stringify(pathToFileURL(helper).href)};
     try{extractionWorker('html');process.exitCode=7}catch(error){console.log(error.message)}`],
    { cwd: nested, env: { NODE_ENV: "test" }, encoding: "utf8", windowsHide: true });
  expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.signal).toBeNull();
  expect(result.stdout.trim()).toBe("Extraction worker binding unavailable");
});
