/**
 * The channel description is the obvious place for a creator to paste their ownership token, and
 * it is also the string we show on their public page. It must not carry the token there.
 */

import { describe, it, expect } from "vitest";
import { stripVerificationToken } from "./rss";

const WALLET = "0x72cf0d122dcda3fcc44bcab6cfea176c262bc157";

describe("stripVerificationToken", () => {
  it("removes the token and the gap it leaves", () => {
    expect(stripVerificationToken(`A curated collection. keryx-verify:${WALLET}`)).toBe(
      "A curated collection.",
    );
  });

  it("removes it from the middle of a sentence", () => {
    expect(stripVerificationToken(`Notes on keryx-verify:${WALLET} payments`)).toBe(
      "Notes on payments",
    );
  });

  it("matches regardless of the case the creator pasted", () => {
    expect(stripVerificationToken(`x KERYX-VERIFY:${WALLET.toUpperCase()}`)).toBe("x");
  });

  it("leaves an ordinary description untouched", () => {
    expect(stripVerificationToken("A blog about payments")).toBe("A blog about payments");
  });
});
