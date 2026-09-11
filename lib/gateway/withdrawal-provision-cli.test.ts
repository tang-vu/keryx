import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

function run(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--no-warnings", "scripts/withdrawal-provision.mts", ...args],
      { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject); child.on("close", code => resolve({ code, stdout, stderr }));
  });
}
it("runs the real CLI read-only and refuses unsafe initialization arguments before RPC", async () => {
  let calls = 0, balance = "0x64";
  const timestamp = `0x${Math.floor(Date.now() / 1000).toString(16)}`;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); calls++;
    const results: Record<string, unknown> = { eth_chainId: "0x4cef52", eth_getBalance: balance,
      eth_getTransactionCount: "0x0", eth_getCode: "0x", eth_getBlockByNumber: {
        number: "0x64", hash: `0x${"ab".repeat(32)}`, timestamp, transactions: [] } };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: results[body.method] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const args = ["--address", `0x${"cd".repeat(20)}`, "--rpc", `http://127.0.0.1:${port}`,
      "--lifetime-gas-budget-wei", "100"];
    for (const extra of [["--initialize"], ["--directory", "/tmp/unselected"],
      ["--initialize", "--directory", "/tmp/unselected", "--max-slots", "1001", "--fresh-key-custody-verified"]]) {
      expect((await run([...args, ...extra])).code).toBe(1); expect(calls).toBe(0);
    }
    const funded = await run(args); expect(funded.stderr).toBe(""); expect(funded.code).toBe(0);
    expect(JSON.parse(funded.stdout)).toMatchObject({ initialized: false, observation: { state: "funded" } });
    balance = "0x63";
    const poor = await run(args); expect(poor.code).toBe(2);
    expect(JSON.parse(poor.stdout)).toMatchObject({ initialized: false, observation: { state: "underfunded" } });
    if (process.platform === "linux") {
      const parent = await mkdtemp("/tmp/keryx-provision-cli-"); await chmod(parent, 0o700);
      try {
        const directory = join(parent, "relay");
        const initialize = [...args, "--initialize", "--directory", directory, "--max-slots", "2", "--fresh-key-custody-verified"];
        expect((await run(initialize)).code).toBe(2);
        await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
        balance = "0x64";
        const created = await run(initialize); expect(created.stderr).toBe(""); expect(created.code).toBe(0);
        expect(JSON.parse(created.stdout)).toMatchObject({ initialized: true, journal: { state: "initialized-empty" } });
        const original = await readFile(join(directory, "mint.sqlite"));
        expect((await run(initialize)).code).toBe(1);
        expect(await readFile(join(directory, "mint.sqlite"))).toEqual(original);
      } finally { await rm(parent, { recursive: true, force: true }); }
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}, 30000);
