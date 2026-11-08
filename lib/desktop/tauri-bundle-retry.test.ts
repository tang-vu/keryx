import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const moduleUrl = new URL("../../desktop/scripts/build-tauri-bundle.mjs", import.meta.url).href;
const zip = "https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip";
const dll = "https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll";

function exercise(mode: string) {
  const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, "keryx-tauri-retry-"));
  try {
    const state = join(root, "state.json"), driver = join(root, "driver.mjs"), runner = join(root, "runner.mjs");
    const nestedDriver = join(root, "nested.mjs"), nestedState = join(root, "nested.json");
    writeFileSync(nestedDriver, `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(nestedState)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`);
    writeFileSync(driver, `
      import{existsSync,readFileSync,writeFileSync}from'node:fs';
      import{spawn}from'node:child_process';
      const state=${JSON.stringify(state)},mode=${JSON.stringify(mode)},zip=${JSON.stringify(zip)},dll=${JSON.stringify(dll)};
      const rows=existsSync(state)?JSON.parse(readFileSync(state,'utf8')):[];
      rows.push({args:process.argv.slice(2),cwd:process.cwd(),pid:process.pid});writeFileSync(state,JSON.stringify(rows));
      const n=rows.length;
      if(mode==='running-abort'){
        spawn(process.execPath,[${JSON.stringify(nestedDriver)}],{stdio:'inherit'});
        console.error('child-ready');setInterval(()=>{},1000);
      }
      else if(mode==='success'||mode==='sequential'&&n===3){console.log('Built installer.');}
      else{
        if(mode!=='no-url')console.error('Downloading '+(mode==='sequential'&&n===2?dll:zip));
        if(mode==='other-url')console.error('Downloading https://example.invalid/nsis-3.11.zip');
        if(mode==='evicted')console.error('x'.repeat(70000));
        if(mode==='compile')console.error('Error failed to bundle project: compiler rejected source');
        else if(mode==='checksum')console.error('Error failed to bundle project: invalid hash');
        else if(mode==='permanent')console.error('Error failed to bundle project: '+String.fromCharCode(96)+'http status: 404'+String.fromCharCode(96));
        else console.error((mode==='ansi'?'\\x1b[31m':'')+'Error failed to bundle project: '+String.fromCharCode(96)+'http status: '+(mode.startsWith('status-')?mode.slice(7):'504')+String.fromCharCode(96)+(mode==='ansi'?'\\x1b[0m':''));
        if(mode==='later-error')console.error('Installer compiler failed after download');
        process.exitCode=mode==='compile'?17:1;
      }
    `);
    writeFileSync(runner, `
      import{bundleTauri}from${JSON.stringify(moduleUrl)};
      import{existsSync,readFileSync}from'node:fs';import{setTimeout as pause}from'node:timers/promises';
      const mode=${JSON.stringify(mode)},controller=new AbortController(),state=${JSON.stringify(state)};
      if(mode==='backoff-abort'){
        const write=process.stderr.write.bind(process.stderr);
        process.stderr.write=(chunk,...rest)=>{const result=write(chunk,...rest);if(String(chunk).includes('retrying build'))queueMicrotask(()=>controller.abort());return result;};
      }
      if(mode==='before-abort')controller.abort();
      const pending=bundleTauri({cliPath:${JSON.stringify(driver)},cwd:${JSON.stringify(root)},backoffMs:mode==='backoff-abort'?5000:0,signal:controller.signal});
      if(mode==='running-abort'){
        const end=Date.now()+5000;while(!existsSync(${JSON.stringify(nestedState)})&&Date.now()<end)await pause(5);controller.abort();
      }
      const result=await pending;
      if(existsSync(${JSON.stringify(nestedState)})){
        const {pid}=JSON.parse(readFileSync(${JSON.stringify(nestedState)},'utf8')),end=Date.now()+2000;
        while(Date.now()<end){try{process.kill(pid,0);}catch{break;}await pause(5);}
      }
      console.log('__BUNDLE_RESULT__'+JSON.stringify(result));process.exitCode=result.code;
    `);
    const child = spawnSync(process.execPath, [runner], { cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 1_000_000 });
    expect(child.error).toBeUndefined(); expect(child.signal).toBeNull();
    const output = child.stdout.match(/__BUNDLE_RESULT__(\{[^\r\n]+\})/);
    expect(output, child.stderr).not.toBeNull();
    const result = JSON.parse(output![1]) as { code: number; attempts: number };
    const rows = result.attempts ? JSON.parse(readFileSync(state, "utf8")) as { args: string[]; cwd: string; pid: number }[] : [];
    expect(rows).toHaveLength(result.attempts); expect(child.status).toBe(result.code);
    for (const row of rows) {
      expect(row.args).toEqual(["build", "--", "--locked"]); expect(row.cwd).toBe(root);
      // All actual subprocesses must be terminal before removing their workspace.
      expect(() => process.kill(row.pid, 0)).toThrow();
    }
    if (mode === "running-abort") {
      expect(existsSync(nestedState)).toBe(true);
      const nested = JSON.parse(readFileSync(nestedState, "utf8")) as { pid: number };
      expect(() => process.kill(nested.pid, 0)).toThrow();
    }
    return { result, rows, stderr: child.stderr };
  } finally {
    // Only this freshly allocated fixture root is removed, after every child exits.
    const state = join(root, "state.json");
    if (existsSync(state)) for (const row of JSON.parse(readFileSync(state, "utf8")) as { pid: number }[])
      expect(() => process.kill(row.pid, 0)).toThrow();
    const nested = join(root, "nested.json");
    if (existsSync(nested)) expect(() => process.kill((JSON.parse(readFileSync(nested, "utf8")) as { pid: number }).pid, 0)).toThrow();
    expect(realpathSync(root)).toBe(root); expect(dirname(root)).toBe(parent);
    expect(basename(root).startsWith("keryx-tauri-retry-")).toBe(true);
    expect(lstatSync(root).isSymbolicLink()).toBe(false);
    for (const name of readdirSync(root)) {
      expect(["driver.mjs", "runner.mjs", "state.json", "nested.mjs", "nested.json"]).toContain(name);
      expect(lstatSync(join(root, name)).isFile()).toBe(true);
      expect(lstatSync(join(root, name)).isSymbolicLink()).toBe(false);
    }
    rmSync(root, { recursive: true });
  }
}

it("runs an ordinary successful build once with the original locked arguments", () => {
  expect(exercise("success").result).toEqual({ code: 0, attempts: 1 });
});
it("recovers sequential pinned ZIP and DLL failures within three actual child attempts", () => {
  const result = exercise("sequential");
  expect(result.result).toEqual({ code: 0, attempts: 3 });
  expect(result.stderr.match(/retrying build/g)).toHaveLength(2);
});
it.each(["persistent", "ansi"])("fails after three attempts for %s transient download errors", mode => {
  expect(exercise(mode).result).toEqual({ code: 1, attempts: 3 });
});
it.each([429, 500, 502, 503, 504])("retains the finite failure bound for HTTP %s", status => {
  expect(exercise(`status-${status}`).result).toEqual({ code: 1, attempts: 3 });
});
it.each(["compile", "checksum", "permanent", "other-url", "no-url", "evicted", "later-error"])("does not retry %s failures", mode => {
  const result = exercise(mode);
  expect(result.result).toEqual({ code: mode === "compile" ? 17 : 1, attempts: 1 });
  expect(result.stderr).not.toContain("retrying build");
});
it.each(["before-abort", "running-abort", "backoff-abort"])("stops without another child on %s", mode => {
  expect(exercise(mode).result).toEqual({ code: 1, attempts: mode === "before-abort" ? 0 : 1 });
});
it("changes only the bundle invocation while retaining the package version, lock and downstream verification", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const manifest = JSON.parse(readFileSync(join(root, "desktop/package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "desktop/package-lock.json"), "utf8"));
  expect(manifest.version).toBe(lock.version); expect(manifest.devDependencies["@tauri-apps/cli"]).toBe("2.12.0");
  expect(manifest.scripts["package:win"]).toBe("npm run native:build && npm run build && node scripts/build-tauri-bundle.mjs && node scripts/stage-package.mjs && npm run verify:package");
  expect(pathToFileURL(join(root, "desktop/scripts/build-tauri-bundle.mjs")).href).toBe(moduleUrl);
});

it("executes the production entry point through a directory junction or symlink", () => {
  const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, "keryx-tauri-entry-"));
  const desktop = join(root, "desktop"), alias = join(root, "desktop-alias"), state = join(root, "state.json");
  const script = join(desktop, "scripts/build-tauri-bundle.mjs"), cliRoot = join(desktop, "node_modules/@tauri-apps/cli");
  try {
    mkdirSync(dirname(script), { recursive: true }); mkdirSync(cliRoot, { recursive: true });
    copyFileSync(fileURLToPath(moduleUrl), script);
    expect(readFileSync(script).equals(readFileSync(fileURLToPath(moduleUrl)))).toBe(true);
    writeFileSync(join(cliRoot, "package.json"), JSON.stringify({ type: "commonjs" }));
    writeFileSync(join(cliRoot, "tauri.js"), `require('node:fs').writeFileSync(${JSON.stringify(state)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),pid:process.pid}));`);
    symlinkSync(desktop, alias, process.platform === "win32" ? "junction" : "dir");
    const child = spawnSync(process.execPath, [join(alias, "scripts/build-tauri-bundle.mjs")], { cwd: root, encoding: "utf8", timeout: 15000 });
    expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
    expect(existsSync(state), "A successful entry must actually invoke the locked CLI").toBe(true);
    const called = JSON.parse(readFileSync(state, "utf8")) as { args: string[]; cwd: string; pid: number };
    expect(called.args).toEqual(["build", "--", "--locked"]); expect(realpathSync(called.cwd)).toBe(desktop);
    expect(() => process.kill(called.pid, 0)).toThrow();
  } finally {
    if (existsSync(state)) expect(() => process.kill((JSON.parse(readFileSync(state, "utf8")) as { pid: number }).pid, 0)).toThrow();
    expect(realpathSync(root)).toBe(root); expect(dirname(root)).toBe(parent); expect(basename(root).startsWith("keryx-tauri-entry-")).toBe(true);
    if (existsSync(alias)) {
      expect(lstatSync(alias).isSymbolicLink()).toBe(true); expect(realpathSync(alias)).toBe(desktop);
      if (process.platform === "win32") rmdirSync(alias); else unlinkSync(alias);
    }
    const allowed = new Set(["state.json", "desktop/scripts/build-tauri-bundle.mjs", "desktop/node_modules/@tauri-apps/cli/tauri.js", "desktop/node_modules/@tauri-apps/cli/package.json"]);
    const inspect = (path: string) => {
      const info = lstatSync(path); expect(info.isSymbolicLink()).toBe(false); expect(realpathSync(path)).toBe(path);
      if (info.isDirectory()) for (const name of readdirSync(path)) inspect(join(path, name));
      else { expect(info.isFile()).toBe(true); expect(allowed.has(relative(root, path).replaceAll("\\", "/"))).toBe(true); }
    };
    inspect(root); rmSync(root, { recursive: true });
  }
});
