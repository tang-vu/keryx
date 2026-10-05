import { expect, it } from "vitest";
import { requestedSources } from "./requested-sources";

it("admits bounded supplied originals without search and retains section requests without claiming a section read", () => {
  const result = requestedSources("Use [WAL](https://www.sqlite.org/wal.html) and https://www.sqlite.org/pragma.html#pragma_synchronous. Then https://www.sqlite.org/pragma.html#another; https://www.sqlite.org/wal.html?utm_source=one");
  expect(result.candidates.size).toBe(2);
  const candidates = [...result.candidates.values()];
  expect(candidates[0].item?.itemUrl).toBe("https://www.sqlite.org/wal.html");
  expect(candidates[1].item?.requestedSource).toEqual({ urls: ["https://www.sqlite.org/pragma.html#pragma_synchronous", "https://www.sqlite.org/pragma.html#another"], readScope: "bounded-whole-document" });
  for (const candidate of candidates) expect(candidate).toMatchObject({ fetchPrice: 0, cached: false, sourceKind: "public-reference", item: { contentVersion: "unread" } });
  expect(result.notices).toEqual([]);
});

it("reports HTTP, credentials, oversized and excess originals without unsafe replacement or credential output", () => {
  const result = requestedSources("http://example.com/a https://user:secret@example.com/a https://example.com/" + "a".repeat(2049)
    + " " + Array.from({ length: 8 }, (_, i) => `https://example.com/${i}`).join(" "));
  expect(result.candidates.size).toBe(5);
  expect(result.notices).toHaveLength(4);
  expect(result.notices[0].reason).toContain("requires HTTPS");
  expect(JSON.stringify(result.notices)).not.toContain("secret");
  expect(result.notices.at(-1)?.reason).toContain("eight-lead limit");
});

it("bounds scans and does not read DNS or infer public eligibility from admission", () => {
  const result = requestedSources("https://127.0.0.1/private " + Array.from({ length: 25 }, (_, i) => `https://example.com/${i}`).join(" "));
  expect(result.candidates.size).toBe(7);
  expect(result.leads[0].refusal).toBe("non-public-literal-host");
  expect(result.notices.at(-1)?.reason).toContain("scan limit");
  expect([...result.candidates.values()][0].description).toContain("unobserved");
});

it("preserves meaningful query values, balanced parentheses and exact-version URLs", () => {
  const result = requestedSources("(https://example.com/path_(edition)?version=v1#part) https://arxiv.org/pdf/2606.02668v1.pdf");
  expect([...result.candidates.values()].map(item => item.item?.requestedSource?.urls[0])).toEqual([
    "https://example.com/path_(edition)?version=v1#part", "https://arxiv.org/pdf/2606.02668v1.pdf",
  ]);
});
