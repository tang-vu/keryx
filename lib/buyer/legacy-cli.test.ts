import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const roots: string[] = [];
const entry = resolve("scripts/a2a-client.mts");
const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("keryx-legacy-cli-")) throw new Error("Invalid test cleanup path");
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([undefined, "{malformed", JSON.stringify({ privateKey: "private-wallet-sentinel", address: "old-wallet" })])(
  "refuses a scheduled purchase without reading, creating or replacing the legacy wallet (%s)", wallet => {
    const root = mkdtempSync(join(tmpdir(), "keryx-legacy-cli-")); roots.push(root);
    mkdirSync(join(root, "data"));
    const file = join(root, "data/a2a-client-wallet.json");
    if (wallet !== undefined) writeFileSync(file, wallet);
    const guard = join(root, "guard.mjs");
    writeFileSync(guard, `
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { throw new Error('Forbidden legacy I/O'); };
globalThis.fetch = deny;
net.connect = net.createConnection = tls.connect = http.request = http.get = https.request = https.get = deny;
const read = fs.readFileSync;
fs.readFileSync = function(path, ...args) {
  const normalized = String(path).split(String.fromCharCode(92)).join('/');
  if (normalized.endsWith('/a2a-client-wallet.json') || normalized.endsWith('/lib/config.ts')) deny();
  return read.call(this, path, ...args);
};
syncBuiltinESMExports();
`);
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP,
      TMP: process.env.TMP, TSX_DISABLE_CACHE: "1", KERYX_BUYER_PRIVATE_KEY: "private-env-sentinel" };
    for (const args of [["private-question-sentinel", "0.03"], [], ["--help"]]) {
      const result = spawnSync(process.execPath, ["--import", loader, "--import", pathToFileURL(guard).href, entry, ...args],
        { cwd: root, env, encoding: "utf8", timeout: 15_000 });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(args[0] === "--help" ? 0 : 1);
      const output = result.stdout + result.stderr;
      expect(output).toContain("The legacy treasury-funded A2A demo is retired.");
      expect(output).toContain("npm run buyer -- --help");
      expect(output).toContain("Do not buy again to recover an old payment.");
      expect(output).not.toMatch(/private-(wallet|env|question)-sentinel|Forbidden legacy I\/O/);
      expect(readdirSync(join(root, "data"))).toEqual(wallet === undefined ? [] : ["a2a-client-wallet.json"]);
      if (wallet !== undefined) expect(readFileSync(file, "utf8")).toBe(wallet);
    }
  }, 60_000,
);

it("does not load the server environment through the npm entry point", () => {
  const manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
  expect(manifest.scripts.a2a).toBe("node --import tsx --no-warnings scripts/a2a-client.mts");
});
