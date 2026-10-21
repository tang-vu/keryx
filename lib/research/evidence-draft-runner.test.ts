import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";

let directory: string, entry: string;
const parent = resolve(tmpdir());
beforeAll(async () => {
  directory = await mkdtemp(join(parent, "keryx-draft-runner-"));
  await mkdir(join(directory, "runner")); entry = join(directory, "runner", "probe.mjs");
  const result = await build({ entryPoints: [join(process.cwd(), "scripts/test-browser-evidence-drafts.mts")], bundle: true,
    write: false, platform: "node", format: "esm", plugins: [{ name: "synthetic-runtime-boundaries", setup(plugin) {
      plugin.onResolve({ filter: /^node:fs\/promises$/ }, args => args.namespace === "probe"
        ? { path: args.path, external: true } : { path: "files", namespace: "probe" });
      plugin.onResolve({ filter: /^node:module$/ }, () => ({ path: "next-host", namespace: "probe" }));
      plugin.onResolve({ filter: /^playwright$/ }, () => ({ path: "browser", namespace: "probe" }));
      plugin.onResolve({ filter: /next-config-fixture$/ }, () => ({ path: "config", namespace: "probe" }));
      plugin.onLoad({ filter: /.*/, namespace: "probe" }, args => ({ loader: "js", contents: args.path === "files" ? `
        import * as fs from 'node:fs/promises';
        export const mkdir=fs.mkdir,writeFile=fs.writeFile;
        export const symlink=async()=>{},readFile=async()=> 'synthetic-build-id';
      ` : args.path === "config" ? `export const copyNextConfigFixture=async()=>{};`
        : args.path === "browser" ? `export const chromium={launch:async()=>{throw new Error('probe workflow failure')}};`
          : `export const createRequire=()=>name=>{
            if(name==='next')return()=>({
              prepare:async()=>{process.on('uncaughtException',()=>console.log('SWALLOWED EXCEPTION'));},
              getRequestHandler:()=>((_request,response)=>response.end('{}')),
              close:async()=>{console.log('cleanup-app');if(process.env.KERYX_DRAFT_RUNNER_PROBE==='cleanup')throw new Error('probe cleanup failure');}
            });
            if(name.endsWith('instrumentation.js'))return{close:async()=>{console.log('cleanup-boot');return true}};
            if(name==='next/dist/trace')return{flushAllTraces:async()=>console.log('cleanup-traces')};
            throw new Error('Unexpected module '+name);
          };` }));
    } }] });
  await writeFile(entry, result.outputFiles[0].contents);
}, 30_000);
afterAll(async () => {
  if (!directory) return;
  const target = resolve(directory), within = relative(parent, target);
  if (!within || within.startsWith("..") || isAbsolute(within)) throw new Error("Refusing unrelated fixture cleanup");
  await rm(target, { recursive: true, force: true });
});

it.each(["workflow", "cleanup"])("returns failure after %s assertions even when the Next host swallows uncaught errors", mode => {
  // Execute the actual script in a child. Only Next/browser/config/build-file
  // boundaries are synthetic; its startup, owned server and graceful cleanup run.
  const child = spawnSync(process.execPath, [entry], { cwd: process.cwd(), encoding: "utf8", windowsHide: true,
    env: { ...process.env, KERYX_DRAFT_RUNNER_PROBE: mode }, timeout: 10_000 });
  expect(child.error).toBeUndefined();
  for (const marker of ["cleanup-app", "cleanup-boot", "cleanup-traces"]) expect(child.stdout).toContain(marker);
  expect(child.status).toBe(1);
  expect(child.stderr).toContain(`probe ${mode} failure`);
  expect(child.stdout).not.toContain("SWALLOWED EXCEPTION");
  expect(child.stdout).not.toContain("all responsive workflows and graceful isolated server close passed");
});
