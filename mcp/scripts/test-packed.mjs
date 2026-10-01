import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const tarball = resolve(process.argv[2]);
const workspace = await mkdtemp(join(tmpdir(), "keryx-mcp-consumer-"));
let child;
try {
  await writeFile(join(workspace, "package.json"), JSON.stringify({ private: true, type: "module" }));
  // The clean consumer intentionally installs only the published package and its dependencies.
  execFileSync(process.execPath, [process.env.npm_execpath ?? process.argv[3], "install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: workspace, stdio: "pipe" });
  const block = join(workspace, "block-network.cjs");
  await writeFile(block, `const deny = () => { throw new Error('Network forbidden in package acceptance'); }; globalThis.fetch = deny; for (const name of ['node:http','node:https']) { const m = require(name); m.request = deny; m.get = deny; } const net = require('node:net'); net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny;`);
  child = spawn(process.execPath, ["--require", block, join(workspace, "node_modules/keryx-mcp/dist/keryx-mcp.mjs")], {
    cwd: workspace,
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      HOME: workspace, USERPROFILE: workspace, TMP: workspace, TEMP: workspace,
      // Public synthetic test scalar; never a funded wallet or a generated private key.
      KERYX_BUYER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
      KERYX_WALLET_FILE: join(workspace, "forbidden-wallet.json"),
      KERYX_PAYMENT_JOURNAL: join(workspace, "forbidden-payment.json"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const responses = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    const message = JSON.parse(line);
    if (message.id !== undefined) responses.get(message.id)?.(message);
  });
  const request = (id, method, params) => new Promise((resolveResponse, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Packaged MCP ${method} timed out`)), 60000);
    responses.set(id, response => { clearTimeout(timeout); response.error ? reject(new Error(`Packaged MCP ${method} failed`)) : resolveResponse(response.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const initialized = await request(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "clean-package-acceptance", version: "1" } });
  assert.equal(initialized.serverInfo.name, "keryx");
  const installedPackage = JSON.parse(await readFile(join(workspace, "node_modules/keryx-mcp/package.json"), "utf8"));
  assert.equal(initialized.serverInfo.version, installedPackage.version, "MCP server must announce its installed package version");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const listed = await request(2, "tools/list", {});
  for (const name of ["ask_keryx", "keryx_wallet_status", "keryx_recover"]) assert(listed.tools.some(tool => tool.name === name), `Missing ${name}`);
  assert(!(await readdir(workspace)).some(name => name.startsWith("forbidden-")), "Startup must not create wallet or payment state");
  console.log("Clean packed MCP initialize/tools/list passed; research network blocked; no wallet/payment state created");
} finally {
  child?.kill();
  if (child) await new Promise(resolveExit => child.exitCode !== null ? resolveExit() : child.once("exit", resolveExit));
  await rm(workspace, { recursive: true, force: true });
}
