import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadPersistentTreasuryWallet } from "./persistent-treasury-wallet";

const directories: string[] = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "persistent-treasury-wallet-"));
  directories.push(directory);
  const privateKey = generatePrivateKey(), address = privateKeyToAccount(privateKey).address;
  return { directory, file: path.join(directory, "spend-wallet.json"), privateKey, address };
}
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe("existing persistent treasury identity", () => {
  it.each(["legacy", "reordered", "lowercase"])("preserves valid synthetic %s bytes and derives matching identity", format => {
    const f = fixture();
    const document = format === "reordered" ? { address: f.address, privateKey: f.privateKey }
      : { privateKey: f.privateKey, address: format === "lowercase" ? f.address.toLowerCase() : f.address };
    const bytes = Buffer.from(JSON.stringify(document, null, 2) + "\n");
    fs.writeFileSync(f.file, bytes);
    expect(loadPersistentTreasuryWallet(f.file)).toEqual({ privateKey: f.privateKey, address: f.address });
    expect(fs.readFileSync(f.file)).toEqual(bytes);
    expect(fs.readdirSync(f.directory)).toEqual(["spend-wallet.json"]);
  });
  it("refuses missing state without creating a wallet or parent directory", () => {
    const f = fixture(), absent = path.join(f.directory, "absent", "spend-wallet.json");
    expect(() => loadPersistentTreasuryWallet(absent)).toThrow("owner recovery required");
    expect(fs.readdirSync(f.directory)).toEqual([]);
    expect(() => loadPersistentTreasuryWallet(f.file)).toThrow("owner recovery required");
    expect(fs.readdirSync(f.directory)).toEqual([]);
  });
  it("refuses a directory without changing its contents", () => {
    const f = fixture();
    expect(() => loadPersistentTreasuryWallet(f.directory)).toThrow("owner recovery required");
    expect(fs.readdirSync(f.directory)).toEqual([]);
  });
  it("refuses a hard-linked wallet without modifying either name", () => {
    const f = fixture(), alias = path.join(f.directory, "alias.json");
    const bytes = JSON.stringify({ privateKey: f.privateKey, address: f.address });
    fs.writeFileSync(f.file, bytes); fs.linkSync(f.file, alias);
    expect(() => loadPersistentTreasuryWallet(f.file)).toThrow("owner recovery required");
    expect(fs.readFileSync(f.file, "utf8")).toBe(bytes);
    expect(fs.readFileSync(alias, "utf8")).toBe(bytes);
  });
  it("refuses a symbolic link before opening its target", () => {
    const f = fixture();
    // A directory junction exercises a real Windows reparse point without
    // requiring the developer-mode privilege for ordinary file symlinks.
    const alias = path.join(f.directory, "link");
    fs.symlinkSync(f.directory, alias, process.platform === "win32" ? "junction" : "dir");
    const open = vi.spyOn(fs, "openSync");
    expect(() => loadPersistentTreasuryWallet(alias)).toThrow("owner recovery required");
    expect(open).not.toHaveBeenCalled();
  });
  it("refuses changed held-file metadata before returning custody", () => {
    const f = fixture(); fs.writeFileSync(f.file, JSON.stringify({ privateKey: f.privateKey, address: f.address }));
    const realStat = fs.fstatSync.bind(fs);
    let calls = 0;
    vi.spyOn(fs, "fstatSync").mockImplementation(((...args: Parameters<typeof fs.fstatSync>) => {
      const stat = realStat(...args);
      if (++calls === 2) stat.size = typeof stat.size === "bigint" ? stat.size + BigInt(1) : stat.size + 1;
      return stat;
    }) as typeof fs.fstatSync);
    expect(() => loadPersistentTreasuryWallet(f.file)).toThrow("owner recovery required");
  });
  it.each(["json", "utf8", "empty", "oversized", "no-address", "wrong-address", "foreign-field", "duplicate-key", "zero-key", "range-key", "malformed-key", "array"])("refuses %s and retains exact source bytes without secret errors", fault => {
    const f = fixture(), value: Record<string, unknown> = { privateKey: f.privateKey, address: f.address };
    if (fault === "no-address") delete value.address;
    if (fault === "wrong-address") value.address = privateKeyToAccount(generatePrivateKey()).address;
    if (fault === "foreign-field") value.repaired = true;
    if (fault === "zero-key") value.privateKey = `0x${"0".repeat(64)}`;
    if (fault === "range-key") value.privateKey = `0x${"f".repeat(64)}`;
    if (fault === "malformed-key") value.privateKey = "broken";
    const bytes = fault === "json" ? Buffer.from("{corrupt") : fault === "utf8" ? Buffer.from([255])
      : fault === "empty" ? Buffer.alloc(0) : fault === "oversized" ? Buffer.alloc(4097, 32)
      : fault === "array" ? Buffer.from("[]") : fault === "duplicate-key" ? Buffer.from(`{"privateKey":"${f.privateKey}","privateKey":"${f.privateKey}","address":"${f.address}"}`)
      : Buffer.from(JSON.stringify(value));
    fs.writeFileSync(f.file, bytes);
    let error: unknown;
    try { loadPersistentTreasuryWallet(f.file); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Persistent treasury wallet unavailable; owner recovery required");
    expect(fs.readFileSync(f.file)).toEqual(bytes);
    expect(fs.readdirSync(f.directory)).toEqual(["spend-wallet.json"]);
  });
  it("keeps one valid identity across independent processes and refuses corrupt/missing state", async () => {
    const f = fixture();
    const bytes = JSON.stringify({ privateKey: f.privateKey, address: f.address });
    fs.writeFileSync(f.file, bytes);
    const corrupt = path.join(f.directory, "corrupt.json"), missing = path.join(f.directory, "missing.json");
    fs.writeFileSync(corrupt, `{\"privateKey\":\"${f.privateKey}\",broken`);
    const loader = new URL("./persistent-treasury-wallet.ts", import.meta.url).href;
    const script = `import { loadPersistentTreasuryWallet } from ${JSON.stringify(loader)}; try { process.stdout.write(loadPersistentTreasuryWallet(process.argv[1]).address); } catch(error) { process.stdout.write(error.message); process.exitCode = 2; }`;
    const run = async (file: string) => {
      try {
        const result = await promisify(execFile)(process.execPath,
          ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "--eval", script, file],
          { timeout: 8000, maxBuffer: 4096,
            env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot, NODE_ENV: "test" } : { NODE_ENV: "test" } });
        return { code: 0, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        const result = error as { code: number; stdout: string; stderr: string };
        return { code: result.code, stdout: result.stdout, stderr: result.stderr };
      }
    };
    const results = await Promise.all([run(f.file), run(f.file), run(missing), run(corrupt)]);
    expect(results.slice(0, 2)).toEqual(Array(2).fill({ code: 0, stdout: f.address, stderr: "" }));
    expect(results.slice(2)).toEqual(Array(2).fill({ code: 2, stdout: "Persistent treasury wallet unavailable; owner recovery required", stderr: "" }));
    expect(fs.readFileSync(f.file, "utf8")).toBe(bytes);
    expect(fs.readdirSync(f.directory).sort()).toEqual(["corrupt.json", "spend-wallet.json"]);
  });
});
