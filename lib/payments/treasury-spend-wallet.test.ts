import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readTreasurySpendWalletAddress } from "./treasury-spend-wallet";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("treasury spend-wallet identity", () => {
  it("reads only a valid public address", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-spend-wallet-"));
    dirs.push(dir);
    const file = path.join(dir, "wallet.json");
    const privateKey = generatePrivateKey();
    const address = privateKeyToAccount(privateKey).address;
    fs.writeFileSync(
      file,
      JSON.stringify({
        privateKey,
        address,
      }),
    );
    expect(readTreasurySpendWalletAddress(file)).toBe(address);
  });

  it("fails closed for missing or malformed wallet state", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-spend-wallet-"));
    dirs.push(dir);
    const file = path.join(dir, "wallet.json");
    expect(readTreasurySpendWalletAddress(file)).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ address: "not-an-address", privateKey: "not-a-key" }));
    expect(readTreasurySpendWalletAddress(file)).toBeNull();
    const privateKey = generatePrivateKey();
    fs.writeFileSync(
      file,
      JSON.stringify({
        address: "0x1111111111111111111111111111111111111111",
        privateKey,
      }),
    );
    expect(readTreasurySpendWalletAddress(file)).toBeNull();
  });
});
