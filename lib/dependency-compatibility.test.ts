import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const anchorRequire = createRequire(require.resolve("@coral-xyz/anchor"));
const toml = anchorRequire("toml") as { parse(input: string | Buffer): Record<string, unknown> };

describe("patched Anchor TOML dependency", () => {
  it("preserves Anchor's CommonJS parse(Buffer) configuration contract", () => {
    const parsed = toml.parse(Buffer.from('[provider]\ncluster = "localnet"\nwallet = "wallet.json"\n[programs.localnet]\nexample = "11111111111111111111111111111111"'));
    expect(parsed.provider).toEqual({ cluster: "localnet", wallet: "wallet.json" });
    expect(parsed.programs).toEqual({ localnet: { example: "11111111111111111111111111111111" } });
  });
  it("rejects traversal through a scalar into the object prototype", () => {
    expect(() => toml.parse('[a.b]\ny = 1\n[a.b.y.__proto__.__proto__]\nkeryxPollutionProbe = "yes"')).toThrow();
    expect(Object.prototype).not.toHaveProperty("keryxPollutionProbe");
  });
  it("bounds nested input with a parser error instead of overflowing the stack", () => {
    let failure: unknown;
    try { toml.parse(`value = ${"[".repeat(600)}0${"]".repeat(600)}`); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(RangeError);
  });
});
