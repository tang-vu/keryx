import { describe, expect, it } from "vitest";
import type { Source } from "../types";
import { ownsSource, sourcesOwnedBy } from "./source-ownership";

const PAYOUT = "0xAAaAAA0000000000000000000000000000000001";
const AUTHOR = "0xBbBBbb0000000000000000000000000000000002";
const STRANGER = "0xcCCccc0000000000000000000000000000000003";

function source(over: Partial<Source> = {}): Source {
  return {
    id: "s1",
    name: "Latent Space",
    url: "https://example.com",
    description: "",
    walletAddress: PAYOUT,
    fetchPrice: 0.003,
    tags: [],
    authors: [{ name: "Author", walletAddress: AUTHOR, splitWeight: 1 }],
    createdAt: "2026-07-19T00:00:00.000Z",
    ...over,
  };
}

describe("ownsSource", () => {
  it("accepts the payout wallet and an author wallet", () => {
    expect(ownsSource(source(), PAYOUT)).toBe(true);
    expect(ownsSource(source(), AUTHOR)).toBe(true);
  });

  it("ignores address casing — checksummed and lowercase are the same wallet", () => {
    expect(ownsSource(source(), PAYOUT.toLowerCase())).toBe(true);
    expect(ownsSource(source({ walletAddress: PAYOUT.toLowerCase() }), PAYOUT)).toBe(true);
  });

  it("rejects a stranger", () => {
    expect(ownsSource(source(), STRANGER)).toBe(false);
  });

  it("does not treat having been paid as ownership", () => {
    // A payee wallet appears on payment rows, never on the source — a split recipient who is
    // not a listed author must not be able to read the source's history.
    expect(ownsSource(source({ authors: [] }), AUTHOR)).toBe(false);
  });
});

describe("sourcesOwnedBy", () => {
  it("keeps only the caller's sources", () => {
    const mine = source({ id: "mine" });
    const theirs = source({ id: "theirs", walletAddress: STRANGER, authors: [] });
    expect(sourcesOwnedBy([mine, theirs], PAYOUT).map((s) => s.id)).toEqual(["mine"]);
  });

  it("returns empty for a wallet that owns nothing", () => {
    expect(sourcesOwnedBy([source()], STRANGER)).toEqual([]);
  });
});
