import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { copyNextConfigFixture, nextConfigFixtureFiles } from "../../test-support/next-config-fixture";
import { runClaimLandingCsp } from "./landing";

it("copies every exact canonical config dependency and loads the isolated fixture with Next's actual unhooked resolver", async () => {
  const source = process.cwd(), fixture = await mkdtemp(join(tmpdir(), "keryx-claim-config-"));
  expect(resolve(fixture).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  try {
    await copyNextConfigFixture(source, fixture);
    for (const file of nextConfigFixtureFiles) expect(await readFile(join(fixture, file))).toEqual(await readFile(join(source, file)));
    await symlink(join(source, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const osKeys = new Set(["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "userprofile", "home"]);
    const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => osKeys.has(key.toLowerCase()))),
      NODE_ENV: "production", NODE_OPTIONS: "", NODE_NO_WARNINGS: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1" };
    const code = `const path=require('node:path');const {transpileConfig}=require('next/dist/build/next-config-ts/transpile-config');
      (async()=>{const loaded=await transpileConfig({nextConfigPath:path.resolve('next.config.ts'),dir:process.cwd()});
      process.stdout.write(JSON.stringify(await (loaded.default??loaded).headers()));})().catch(error=>{console.error(error);process.exitCode=1;});`;
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ["-e", code], { cwd: fixture, env, encoding: "utf8", timeout: 20000, maxBuffer: 1048576, windowsHide: true });
    expect(stderr).toBe("");
    const rules = JSON.parse(stdout) as { source: string; headers: { key: string; value: string }[] }[];
    expect(rules.find(rule => rule.source === "/claim-run")?.headers).toContainEqual({ key: "Content-Security-Policy", value: runClaimLandingCsp });
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
