import { expect, it } from "vitest";
import { parseListingSnapshot, sameListingSnapshot } from "./listing-snapshot";
const value = { mode: "onchain", active: true, fetchPrice: 0.002,
  registryAddress: `0x${"a".repeat(40)}`, onchainId: `0x${"1".repeat(64)}`, creator: `0x${"b".repeat(40)}`,
  current: { payoutWallet: `0x${"c".repeat(40)}`, authors: [], fetchPriceUsdc6: "2000", contentCid: "cid", tags: "research" } };
it("normalizes address casing and ignores unrelated response fields", () => {
  expect(sameListingSnapshot(value, { ...value, registryAddress: `0x${"A".repeat(40)}`, extra: "not-authority" })).toBe(true);
});
it.each([
  { ...value, active: false }, { ...value, creator: `0x${"d".repeat(40)}` },
  { ...value, registryAddress: `0x${"d".repeat(40)}` }, { ...value, onchainId: `0x${"2".repeat(64)}` },
  { ...value, current: { ...value.current, payoutWallet: `0x${"d".repeat(40)}` } },
  { ...value, current: { ...value.current, authors: [{ wallet: `0x${"d".repeat(40)}`, basisPoints: 10000 }] } },
  { ...value, current: { ...value.current, contentCid: "new-cid" } },
  { ...value, current: { ...value.current, tags: "new-tags" } },
  { ...value, fetchPrice: 0.003, current: { ...value.current, fetchPriceUsdc6: "3000" } },
])("detects changed signing state %#", fresh => expect(sameListingSnapshot(value, fresh)).toBe(false));
it.each([
  null, {}, { ...value, mode: "offline" }, { ...value, creator: "bad-address" },
  { ...value, current: { ...value.current, fetchPriceUsdc6: "2000.0" } },
  { ...value, current: { ...value.current, fetchPriceUsdc6: "18446744073709551616" } },
  { ...value, fetchPrice: 0.05 },
  { ...value, current: { ...value.current, tags: "é".repeat(129) } },
  { ...value, current: { ...value.current, authors: [{ wallet: value.creator, basisPoints: 9999 }] } },
])("refuses malformed or inconsistent state %#", fresh => {
  expect(() => parseListingSnapshot(fresh)).toThrow("Listing data is unavailable");
});
