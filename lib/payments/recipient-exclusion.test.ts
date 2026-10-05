import { expect, it } from "vitest";
import type { Source } from "../types";
import type { SourceFetchTerms } from "../registry/source-fetch-payto";
import { assertRecipientAllowed, sourceRecipientIsExcluded } from "./recipient-exclusion";

const asker = `0x${"ab".repeat(20)}`, independent = `0x${"12".repeat(20)}`;
const source = { walletAddress: asker, authors: [{ walletAddress: asker }] } as Source;
const terms: SourceFetchTerms = { payTo: independent, creator: independent, listPriceUsdc: 0.002,
  active: true, authority: "onchain", stale: false, citationWallets: new Set([independent]) };

it("uses current registry recipients instead of stale DB source/author wallets", () => {
  expect(sourceRecipientIsExcluded(source, terms, asker)).toBe(false);
  expect(sourceRecipientIsExcluded(source, { ...terms, payTo: asker }, asker)).toBe(true);
  expect(sourceRecipientIsExcluded(source, { ...terms, citationWallets: new Set([asker.toUpperCase()]) }, asker)).toBe(true);
  expect(sourceRecipientIsExcluded(source, { ...terms, citationWallets: undefined, authority: "database" }, asker)).toBe(true);
});

it("applies a downward-only exact recipient restriction without changing allowed payment terms", () => {
  expect(() => assertRecipientAllowed(asker.toUpperCase(), asker)).toThrow(/recipient is excluded/);
  expect(() => assertRecipientAllowed(undefined, asker)).toThrow(/recipient is excluded/);
  expect(() => assertRecipientAllowed(independent, asker)).not.toThrow();
  expect(() => assertRecipientAllowed(asker)).not.toThrow();
  expect(sourceRecipientIsExcluded(source, { ...terms, payTo: asker })).toBe(false);
});
