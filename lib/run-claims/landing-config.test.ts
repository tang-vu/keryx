import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { runClaimLandingResponse } from "./landing";

it("loads private headers through Next's actual config loader without an application TypeScript hook", async () => {
  const osKeys = new Set(["path", "systemroot", "windir", "systemdrive", "comspec", "pathext", "temp", "tmp", "userprofile", "home"]);
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => osKeys.has(key.toLowerCase()))),
    NODE_ENV: "production", NODE_OPTIONS: "", NODE_NO_WARNINGS: "1", NEXT_TELEMETRY_DISABLED: "1",
    KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
  };
  const code = `
    const path = require('node:path');
    const { transpileConfig } = require('next/dist/build/next-config-ts/transpile-config');
    (async () => {
      const loaded = await transpileConfig({ nextConfigPath: path.resolve('next.config.ts'), dir: process.cwd() });
      const config = loaded.default ?? loaded;
      process.stdout.write(JSON.stringify({ distDir: config.distDir, rules: await config.headers() }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ["-e", code], {
    cwd: process.cwd(), env, encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  expect(stderr).toBe("");
  const { distDir, rules } = JSON.parse(stdout) as {
    distDir: string; rules: { source: string; headers: { key: string; value: string }[] }[];
  };
  expect(distDir).toBe(".next");
  const globalIndex = rules.findIndex(rule => rule.source === "/(.*)");
  const claimIndex = rules.findIndex(rule => rule.source === "/claim-run");
  expect(claimIndex).toBeGreaterThan(globalIndex);
  const effective = new Map(rules[globalIndex].headers.map(header => [header.key.toLowerCase(), header.value]));
  for (const header of rules[claimIndex].headers) effective.set(header.key.toLowerCase(), header.value);
  const response = runClaimLandingResponse(true);
  for (const key of ["content-security-policy", "cache-control", "referrer-policy", "x-robots-tag", "x-frame-options"])
    expect(effective.get(key)).toBe(response.headers.get(key));
});
