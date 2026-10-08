import { expect, it } from "vitest";
import type { ArticleContentManifest, PaymentRecord, SourceItem } from "../types";
import { contentBodyHash, contentBytes } from "../sources/content-receipt";
import { readPaidArticleBody, selectedArticleBodyContract } from "./paid-article-body";
import { pendingPaymentFrom, settledPaymentFrom } from "./payment-state";

const text = "Exact Unicode bytes: café 🌍.\nNo normalization of the paid body.";
const item: SourceItem = { id: "article", sourceId: "publisher", title: "Article", link: "https://fixture.invalid/article",
  summary: "Preview", content: text, bodyHash: contentBodyHash(text), plaintextBytes: contentBytes(text) };
const manifest = { bodyHash: item.bodyHash!, plaintextBytes: item.plaintextBytes! } as ArticleContentManifest;
const payment: PaymentRecord = { kind: "fetch", queryId: "offline-fixture", sourceId: "publisher", sourceName: "Publisher",
  payer: "synthetic-payer", payee: "synthetic-payee", amountUsdc: .004, authorizationId: `0x${"45".repeat(32)}`,
  network: "eip155:5042002", settled: false, settlementStatus: "pending", txHash: null, createdAt: "2026-10-09T00:00:00.000Z" };

it("captures and freezes only explicitly selected plaintext commitments, including a manifest", () => {
  const selected = { ...item, bodyHash: undefined, plaintextBytes: undefined, manifest: { ...manifest } };
  const contract = selectedArticleBodyContract(selected);
  selected.manifest.bodyHash = contentBodyHash("Changed after selection");
  expect(Object.isFrozen(contract)).toBe(true);
  expect(readPaidArticleBody(text, contract, { ...payment })).toBe(text);
  expect(selectedArticleBodyContract({ ...item, bodyHash: undefined, plaintextBytes: undefined })).toEqual({});
});

it.each([
  { bodyHash: "" }, { bodyHash: "0x1234" }, { plaintextBytes: NaN }, { plaintextBytes: -1 }, { plaintextBytes: 1.5 },
  { manifest: { ...manifest, bodyHash: contentBodyHash("A different selected body") } },
  { manifest: { ...manifest, plaintextBytes: 1 } },
])("refuses malformed or conflicting selected contract %j", patch => {
  expect(() => selectedArticleBodyContract({ ...item, ...patch })).toThrow(/selected paid article body/);
});

it.each([false, true])("retains the same %s settled flag and original amounts/nonces on byte-count failure", settled => {
  const original = { ...payment, settled, settlementStatus: settled ? "settled" as const : "pending" as const,
    txHash: settled ? "synthetic-fixture-receipt" : null };
  let caught: unknown;
  try { readPaidArticleBody(text, { plaintextBytes: text.length }, original); } catch (error) { caught = error; }
  expect(String(caught)).toContain("byte count");
  expect(settled ? settledPaymentFrom(caught) : pendingPaymentFrom(caught)).toBe(original);
  expect(original).toMatchObject({ amountUsdc: payment.amountUsdc, payee: payment.payee, authorizationId: payment.authorizationId,
    settled, settlementStatus: settled ? "settled" : "pending" });
});

it("rejects whitespace-only legacy delivery but preserves nonempty bodies without inventing a receipt", () => {
  expect(() => readPaidArticleBody(" \n\t", {}, { ...payment })).toThrow("paid article body is missing, empty or not text");
  expect(readPaidArticleBody(text, {}, { ...payment })).toBe(text);
});
