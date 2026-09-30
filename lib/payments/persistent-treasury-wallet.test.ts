import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadPersistentTreasuryWallet } from "./persistent-treasury-wallet";

const directories: string[] = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "persistent-treasury-wallet-"));
  directories.push(directory);
  const privateKey = generatePrivateKey(), address = privateKeyToAccount(privateKey).address;
  return { directory, file: path.join(directory, "spend-wallet.json"), privateKey, address };
}
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

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
});
