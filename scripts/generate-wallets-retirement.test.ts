import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it.each([false, true])("actual retired generator preserves existing custody=%s without entropy or private access", async (existing) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "wallet-generator-retired-"));
  const directory = path.join(workspace, "working");
  const envFile = path.join(directory, ".env.local");
  const wallet = path.join(directory, "data", "spend-wallet.json");
  const syntheticEnv = "SELLER_PRIVATE_KEY=synthetic-owner-secret-preserve\nBUYER_PRIVATE_KEY=synthetic-retired-secret-preserve\nAGENT_FUNDER_PRIVATE_KEY=synthetic-current-secret-preserve\n";
  const syntheticWallet = "retained synthetic custody bytes\n";
  const script = fileURLToPath(new URL("./generate-wallets.mts", import.meta.url));
  const guard = path.join(workspace, "guard.cjs");
  try {
    await fs.mkdir(directory);
    if (existing) {
      await fs.mkdir(path.dirname(wallet));
      await fs.writeFile(envFile, syntheticEnv);
      await fs.writeFile(wallet, syntheticWallet);
    }
    await fs.writeFile(guard, `
const deny=()=>{throw new Error('Forbidden key, custody or network effect');};
const crypto=require('node:crypto');
for(const method of ['randomBytes','randomFillSync','randomFill','generateKeyPair','generateKeyPairSync'])crypto[method]=deny;
crypto.webcrypto.getRandomValues=deny;
for(const name of ['node:http','node:https']){const module=require(name);module.request=deny;module.get=deny;}
const net=require('node:net');net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;
globalThis.fetch=deny;
const fs=require('node:fs'),path=require('node:path');
const privatePaths=${JSON.stringify([envFile, wallet])};
for(const method of ['readFileSync','openSync','existsSync','statSync','lstatSync']){
 const original=fs[method];fs[method]=function(file,...args){if(privatePaths.includes(path.resolve(String(file))))deny();return original.call(this,file,...args);};
}
for(const method of ['writeFileSync','writeFile','appendFileSync','appendFile','renameSync','rename','unlinkSync','unlink','mkdirSync','mkdir'])fs[method]=deny;
`);
    const env = { NODE_ENV: "test" as const, SELLER_PRIVATE_KEY: "synthetic-process-secret-do-not-print",
      ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) };
    let refused: unknown;
    try { await promisify(execFile)(process.execPath, ["--require", guard, script], { cwd: directory, env, timeout: 8000 }); }
    catch (error) { refused = error; }
    expect(refused).toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("Legacy wallet generation is disabled") });
    const help = await promisify(execFile)(process.execPath, ["--require", guard, script, "--help"], { cwd: directory, env, timeout: 8000 });
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("AGENT_FUNDER_PRIVATE_KEY");
    expect(help.stdout).toContain("KERYX_BUYER_PRIVATE_KEY");
    for (const output of [(refused as { stderr: string }).stderr, help.stdout]) {
      expect(output).not.toContain("synthetic-");
      expect(output).not.toMatch(/0x[0-9a-f]{64}/i);
      expect(output).not.toContain("Forbidden key, custody or network effect");
    }
    expect((await fs.readdir(directory)).sort()).toEqual(existing ? [".env.local", "data"] : []);
    if (existing) {
      expect(await fs.readFile(envFile, "utf8")).toBe(syntheticEnv);
      expect(await fs.readFile(wallet, "utf8")).toBe(syntheticWallet);
      expect(await fs.readdir(path.dirname(wallet))).toEqual(["spend-wallet.json"]);
    }
  } finally { await fs.rm(workspace, { recursive: true, force: true }); }
});
