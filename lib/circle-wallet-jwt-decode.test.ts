import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decode } from "./circle-wallet-jwt-decode";
const require = createRequire(import.meta.url);
const transform = require("../scripts/circle-sdk-browser-loader.cjs") as (source: string) => string;
const token = (payload: unknown) => `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.synthetic`;
it("decodes nonce claims without treating them as verified identity", () => {
  expect(decode(token({ nonce: "synthetic-nonce", sub: "unverified-google-subject" }))).toEqual({ nonce: "synthetic-nonce", sub: "unverified-google-subject" });
  for (const value of [null, "invalid", "badheader.e30.signature", token(null), "x".repeat(16385)]) expect(decode(value)).toBeNull();
});
it("rewrites only the pinned SDK's sole decode import and refuses vendor drift", () => {
  const file = require.resolve("@circle-fin/w3s-pw-web-sdk"); const source = readFileSync(file, "utf8");
  const result = transform(source);
  expect(result).not.toContain('require("jsonwebtoken")'); expect(result).toContain("circle-wallet-jwt-decode.ts");
  const adapterImport = result.match(/require\(["']([^"']+circle-wallet-jwt-decode\.ts)["']\)/)?.[1];
  expect(adapterImport).toMatch(/^\.\.?\//); expect(adapterImport).not.toMatch(/^[A-Za-z]:/);
  expect(() => transform(source.replace("jsonwebtoken_1.decode", "jsonwebtoken_1.verify"))).toThrow("usage changed");
  expect(() => transform(`${source}\njsonwebtoken_1.sign()`)).toThrow("usage changed");
  expect(() => transform("module.exports = {};")).toThrow("usage changed");
});
