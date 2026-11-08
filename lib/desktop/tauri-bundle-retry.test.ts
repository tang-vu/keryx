import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { assertTauriExecutablePair } from "../../desktop/scripts/compare-tauri-packages.mjs";

const moduleUrl = new URL("../../desktop/scripts/build-tauri-bundle.mjs", import.meta.url).href;
const zip = "https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip";
const dll = "https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll";
const original = Buffer.concat([Buffer.from([77, 90, 0, 255, 13]), Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK"), Buffer.from([0, 171, 23, 128])]);
const encodedOriginal = original.toString("base64");
type Call = { args: string[]; cwd: string; pid: number; nativeMode?: number; originalMatched?: boolean };
type Result = { code: number; attempts: number; restoreError?: string };

function exercise(mode: string) {
  const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, "keryx-tauri-retry-"));
  const desktop = mode === "entry-alias" ? join(root, "desktop") : root;
  const state = join(root, "state.json"), driver = join(root, "driver.mjs"), runner = join(root, "runner.mjs");
  const executable = join(desktop, "src-tauri/target/release/KeryxOperator.exe"), installed = join(root, "installed.exe");
  const nestedDriver = join(root, "nested.mjs"), nestedState = join(root, "nested.json"), foreign = join(root, "foreign"), alias = join(root, "desktop-alias");
  try {
    writeFileSync(nestedDriver, `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(nestedState)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`);
    writeFileSync(driver, `
      import{existsSync,readFileSync,writeFileSync,mkdirSync,statSync,truncateSync,unlinkSync,symlinkSync}from'node:fs';
      import{dirname,join}from'node:path';import{spawn}from'node:child_process';
      const state=${JSON.stringify(state)},mode=${JSON.stringify(mode)},exe=${JSON.stringify(executable)},installed=${JSON.stringify(installed)},foreign=${JSON.stringify(foreign)};
      const original=Buffer.from(${JSON.stringify(encodedOriginal)},'base64'),zip=${JSON.stringify(zip)},dll=${JSON.stringify(dll)};
      const rows=existsSync(state)?JSON.parse(readFileSync(state,'utf8')):[],args=process.argv.slice(2),row={args,cwd:process.cwd(),pid:process.pid};rows.push(row);
      const save=()=>writeFileSync(state,JSON.stringify(rows));save();
      const hold=()=>{spawn(process.execPath,[${JSON.stringify(nestedDriver)}],{stdio:'inherit'});setInterval(()=>{},1000);};
      function main(){
        if(args[0]==='build'){
          if(mode==='compile'){console.error('Downloading '+zip);console.error('Error failed to bundle project: '+String.fromCharCode(96)+'http status: 504'+String.fromCharCode(96));process.exitCode=17;return;}
          if(mode==='build-abort'){hold();return;}
          mkdirSync(dirname(exe),{recursive:true});
          if(mode==='missing-native')return;
          if(mode==='linked-native'){mkdirSync(foreign,{recursive:true});writeFileSync(join(foreign,'sentinel.bin'),'untouched');symlinkSync(foreign,exe,process.platform==='win32'?'junction':'dir');return;}
          writeFileSync(exe,mode==='wrong-marker'?Buffer.from(original.toString('binary').replace('_UNK','_NSS'),'binary'):original,{mode:0o755});
          if(mode==='oversize-native')truncateSync(exe,128*1024*1024+1);
          row.nativeMode=statSync(exe).mode&0o777;save();return;
        }
        const n=rows.filter(row=>row.args[0]==='bundle').length,before=readFileSync(exe);row.originalMatched=before.equals(original);save();
        const patched=Buffer.from(before),offset=patched.indexOf('__TAURI_BUNDLE_TYPE_VAR_UNK');
        if(offset>=0)patched.write('__TAURI_BUNDLE_TYPE_VAR_NSS',offset);writeFileSync(exe,patched);
        if(mode==='running-abort'){hold();return;}
        if(mode==='success'||mode==='entry-alias'||mode==='sequential'&&n===3){writeFileSync(installed,patched);writeFileSync(exe,before);return;}
        if(mode==='missing-after')unlinkSync(exe);
        if(mode==='linked-after'){unlinkSync(exe);mkdirSync(foreign,{recursive:true});writeFileSync(join(foreign,'sentinel.bin'),'untouched');symlinkSync(foreign,exe,process.platform==='win32'?'junction':'dir');}
        if(mode!=='no-url')console.error('Downloading '+(mode==='sequential'&&n===2?dll:zip));
        if(mode==='other-url')console.error('Downloading https://example.invalid/nsis-3.11.zip');
        if(mode==='evicted')console.error('x'.repeat(70000));
        if(mode==='checksum')console.error('Error failed to bundle project: invalid hash');
        else if(mode==='permanent')console.error('Error failed to bundle project: '+String.fromCharCode(96)+'http status: 404'+String.fromCharCode(96));
        else console.error((mode==='ansi'?'\\x1b[31m':'')+'Error failed to bundle project: '+String.fromCharCode(96)+'http status: '+(mode.startsWith('status-')?mode.slice(7):'504')+String.fromCharCode(96)+(mode==='ansi'?'\\x1b[0m':''));
        if(mode==='later-error')console.error('Installer compiler failed after download');process.exitCode=1;
      }main();
    `);
    let command = runner;
    if (mode === "entry-alias") {
      const script = join(desktop, "scripts/build-tauri-bundle.mjs"), cliRoot = join(desktop, "node_modules/@tauri-apps/cli");
      mkdirSync(dirname(script), { recursive: true }); mkdirSync(cliRoot, { recursive: true });
      copyFileSync(fileURLToPath(moduleUrl), script);
      expect(readFileSync(script).equals(readFileSync(fileURLToPath(moduleUrl)))).toBe(true);
      writeFileSync(join(cliRoot, "package.json"), JSON.stringify({ type: "module" })); copyFileSync(driver, join(cliRoot, "tauri.js"));
      symlinkSync(desktop, alias, process.platform === "win32" ? "junction" : "dir"); command = join(alias, "scripts/build-tauri-bundle.mjs");
    } else writeFileSync(runner, `
      import{bundleTauri}from${JSON.stringify(moduleUrl)};import{existsSync,readFileSync}from'node:fs';import{setTimeout as pause}from'node:timers/promises';
      const mode=${JSON.stringify(mode)},controller=new AbortController(),state=${JSON.stringify(state)};
      if(mode==='backoff-abort'){
        const write=process.stderr.write.bind(process.stderr);
        process.stderr.write=(chunk,...rest)=>{const result=write(chunk,...rest);if(String(chunk).includes('retrying bundle'))queueMicrotask(()=>controller.abort());return result;};
      }
      if(mode==='before-abort')controller.abort();
      const pending=bundleTauri({cliPath:${JSON.stringify(driver)},cwd:${JSON.stringify(desktop)},backoffMs:mode==='backoff-abort'?5000:0,signal:controller.signal});
      if(mode==='running-abort'||mode==='build-abort'){
        const end=Date.now()+5000;while(!existsSync(${JSON.stringify(nestedState)})&&Date.now()<end)await pause(5);controller.abort();
      }
      let result;try{result=await pending;}catch(error){console.error(error.message);result={code:1,attempts:JSON.parse(readFileSync(state,'utf8')).filter(row=>row.args[0]==='bundle').length,restoreError:error.message};}
      if(existsSync(${JSON.stringify(nestedState)})){
        const {pid}=JSON.parse(readFileSync(${JSON.stringify(nestedState)},'utf8')),end=Date.now()+2000;
        while(Date.now()<end){try{process.kill(pid,0);}catch{break;}await pause(5);}
      }
      console.log('__BUNDLE_RESULT__'+JSON.stringify(result));process.exitCode=result.code;
    `);
    const child = spawnSync(process.execPath, [command], { cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 1_000_000 });
    expect(child.error).toBeUndefined(); expect(child.signal).toBeNull();
    const rows = existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) as Call[] : [];
    const builds = rows.filter(row => row.args[0] === "build"), bundles = rows.filter(row => row.args[0] === "bundle");
    let result: Result;
    if (mode === "entry-alias") { result = { code: child.status!, attempts: bundles.length }; expect(builds).toHaveLength(1); expect(bundles).toHaveLength(1); }
    else {
      const output = child.stdout.match(/__BUNDLE_RESULT__(\{[^\r\n]+\})/); expect(output, child.stderr).not.toBeNull(); result = JSON.parse(output![1]);
    }
    expect(child.status).toBe(result.code); expect(bundles).toHaveLength(result.attempts);
    expect(builds.length).toBe(mode === "before-abort" ? 0 : 1);
    for (const row of builds) expect(row.args).toEqual(["build", "--no-bundle", "--", "--locked"]);
    for (const row of bundles) { expect(row.args).toEqual(["bundle"]); expect(row.originalMatched).toBe(true); }
    for (const row of rows) { expect(realpathSync(row.cwd)).toBe(desktop); expect(() => process.kill(row.pid, 0)).toThrow(); }
    if (mode === "running-abort" || mode === "build-abort") {
      expect(existsSync(nestedState)).toBe(true); expect(() => process.kill((JSON.parse(readFileSync(nestedState, "utf8")) as { pid: number }).pid, 0)).toThrow();
    }
    const invalid = ["before-abort", "build-abort", "compile", "missing-native", "oversize-native", "wrong-marker", "linked-native", "missing-after", "linked-after"];
    if (!invalid.includes(mode)) {
      expect(readFileSync(executable).equals(original)).toBe(true);
      expect(lstatSync(executable).mode & 0o777).toBe(builds[0].nativeMode);
    }
    if (result.code === 0) assertTauriExecutablePair(readFileSync(executable), readFileSync(installed));
    if (existsSync(foreign)) expect(readFileSync(join(foreign, "sentinel.bin"), "utf8")).toBe("untouched");
    return { result, rows, stderr: child.stderr };
  } finally {
    if (existsSync(state)) for (const row of JSON.parse(readFileSync(state, "utf8")) as Call[]) expect(() => process.kill(row.pid, 0)).toThrow();
    if (existsSync(nestedState)) expect(() => process.kill((JSON.parse(readFileSync(nestedState, "utf8")) as { pid: number }).pid, 0)).toThrow();
    expect(realpathSync(root)).toBe(root); expect(dirname(root)).toBe(parent); expect(basename(root).startsWith("keryx-tauri-retry-")).toBe(true);
    for (const [link, target] of [[alias, desktop], [executable, foreign]]) if (existsSync(link) && lstatSync(link).isSymbolicLink()) {
      expect(realpathSync(link)).toBe(target); if (process.platform === "win32") rmdirSync(link); else unlinkSync(link);
    }
    const allowed = new Set(["driver.mjs", "runner.mjs", "nested.mjs", "state.json", "nested.json", "installed.exe", "foreign/sentinel.bin",
      relative(root, executable).replaceAll("\\", "/"), "desktop/scripts/build-tauri-bundle.mjs", "desktop/node_modules/@tauri-apps/cli/tauri.js", "desktop/node_modules/@tauri-apps/cli/package.json"]);
    const inspect = (path: string) => {
      const info = lstatSync(path); expect(info.isSymbolicLink()).toBe(false); expect(realpathSync(path)).toBe(path);
      if (info.isDirectory()) for (const name of readdirSync(path)) inspect(join(path, name));
      else { expect(info.isFile()).toBe(true); expect(allowed.has(relative(root, path).replaceAll("\\", "/"))).toBe(true); }
    };
    inspect(root); rmSync(root, { recursive: true });
  }
}

it("compiles once with locked dependencies and preserves the genuine portable/installer pair", () => {
  expect(exercise("success").result).toEqual({ code: 0, attempts: 1 });
});
it("preserves the portable original across sequential ZIP and DLL failures", () => {
  const value = exercise("sequential"); expect(value.result).toEqual({ code: 0, attempts: 3 });
  expect(value.stderr.match(/retrying bundle/g)).toHaveLength(2);
});
it.each(["persistent", "ansi"])("fails after three bundles and restores original bytes for %s", mode => {
  expect(exercise(mode).result).toEqual({ code: 1, attempts: 3 });
});
it.each([429, 500, 502, 503, 504])("retains the bundle ceiling for HTTP %s", status => {
  expect(exercise(`status-${status}`).result).toEqual({ code: 1, attempts: 3 });
});
it.each(["checksum", "permanent", "other-url", "no-url", "evicted", "later-error"])("does not retry %s and restores the original", mode => {
  const value = exercise(mode); expect(value.result).toEqual({ code: 1, attempts: 1 }); expect(value.stderr).not.toContain("retrying bundle");
});
it("never retries a failed native compile even when its output resembles a tool-download error", () => {
  expect(exercise("compile").result).toEqual({ code: 17, attempts: 0 });
});
it.each(["before-abort", "build-abort", "running-abort", "backoff-abort"])("stops its tree, preserves available originals and never retries on %s", mode => {
  expect(exercise(mode).result).toEqual({ code: 1, attempts: mode === "running-abort" || mode === "backoff-abort" ? 1 : 0 });
});
it.each(["missing-native", "oversize-native", "wrong-marker", "linked-native"])("refuses %s before any bundle attempt", mode => {
  expect(exercise(mode).result).toEqual({ code: 1, attempts: 0 });
});
it.each(["missing-after", "linked-after"])("fails closed when original restoration encounters %s", mode => {
  const value = exercise(mode); expect(value.result).toMatchObject({ code: 1, attempts: 1 }); expect(value.result.restoreError).toBeTruthy();
  expect(value.stderr).not.toContain("retrying bundle");
});
it("executes the production entry through a directory alias and restores the portable original", () => {
  expect(exercise("entry-alias").result).toEqual({ code: 0, attempts: 1 });
});
it("keeps package versions, dependency locks and downstream staging/verification", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const manifest = JSON.parse(readFileSync(join(root, "desktop/package.json"), "utf8")), lock = JSON.parse(readFileSync(join(root, "desktop/package-lock.json"), "utf8"));
  expect(manifest.version).toBe(lock.version); expect(manifest.devDependencies["@tauri-apps/cli"]).toBe("2.12.0");
  expect(manifest.scripts["package:win"]).toBe("npm run native:build && npm run build && node scripts/build-tauri-bundle.mjs && node scripts/stage-package.mjs && npm run verify:package");
});
