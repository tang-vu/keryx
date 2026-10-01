import { expect, it } from "vitest";
import {
  assertVerifiedBrowserOriginalSourceContextCurrent,
  createSyntheticBrowserOriginalSourceAuthority,
  prepareBrowserSourceSigningAdmission,
  type VerifiedBrowserOriginalSourceContext,
} from "./browser-original-source-authority";
import type { BrowserSourceOriginalAdmission } from "../db/browser-signing-originals";

it("cannot manufacture source authority by JSON serialization or a caller supplied frozen token", () => {
  const token = Object.freeze({}) as VerifiedBrowserOriginalSourceContext;
  const input = {} as BrowserSourceOriginalAdmission;
  expect(() =>
    assertVerifiedBrowserOriginalSourceContextCurrent(token, input)
  ).toThrow("refused");
  expect(() => prepareBrowserSourceSigningAdmission(input, token)).toThrow(
    "refused"
  );
});
it("synthetic composition refuses a production provider or credential-bearing localhost URL", () => {
  const catalog = {
    getSource: async () => null,
    getItem: async () => null,
    getArticleOffer: async () => null,
  };
  const registry = "0x2222222222222222222222222222222222222222";
  expect(() =>
    createSyntheticBrowserOriginalSourceAuthority(
      catalog,
      "https://rpc.testnet.arc.network",
      registry
    )
  ).toThrow("refused");
  expect(() =>
    createSyntheticBrowserOriginalSourceAuthority(
      catalog,
      "http://user:pass@127.0.0.1:1234",
      registry
    )
  ).toThrow("refused");
});
