import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DisplayTime } from "../../components/keryx/display-time";
import { SigningAmount } from "../../components/keryx/signing-amount";
import { formatAmount, formatNumber, type DisplayLocale } from "./format";
import { shippedUiLocales } from "./locales";
import { buildCitationExport } from "../research-citation-export";
import { buildResearchReceipt, canonicalJson } from "../research-receipt";
import { researchReportMarkdown } from "../research-report-export";
import { remoteResearchResult } from "../mcp/remote-server";
import { keryxMeta } from "../openai-compat";
import { toCsv } from "../creator/csv";
import type { QueryRun } from "../types";

describe("locale display consumers preserve verification and machine contracts", () => {
  it.each(shippedUiLocales)("shows canonical exact confirmation details for shipped %s", () => {
    for (const micros of ["1", "9999", "1000000000", "9007199254740991"]) {
      const html = renderToStaticMarkup(createElement(SigningAmount, { micros }));
      expect(html).toContain(`${micros} micro-USDC`);
      expect(html).toContain("USDC");
      expect(html).toContain("decimal point, no grouping");
      expect(html).toContain("break-words");
      expect(html).not.toContain("9,007");
    }
    expect(renderToStaticMarkup(createElement(SigningAmount, { micros: "1,000" }))).toContain("Amount unavailable");
  });
  it("retains the exact UTC title in viewer-zone and relative displays", () => {
    const value = "2026-10-11T00:30:00Z";
    const html = renderToStaticMarkup(createElement(DisplayTime, { value, timeZone: "America/Los_Angeles" }));
    expect(html).toContain("Oct 10, 2026");
    expect(html).toMatch(/datetime="2026-10-11T00:30:00\.000Z"/i);
    expect(html).toContain('title="2026-10-11T00:30:00.000Z"');
    const relative = renderToStaticMarkup(createElement(DisplayTime, { value, now: "2026-10-11T00:32:00Z" }));
    expect(relative).toContain("2 minutes ago");
    expect(relative).toContain('title="2026-10-11T00:30:00.000Z"');
  });
  it("keeps real serializers byte-identical while each display locale formats the same original", () => {
    const run: QueryRun = { id: "locale-fixture", question: "Synthetic offline formatting fixture", budget: 0.05,
      engine: "heuristic", subClaims: [], decisions: [], citations: [{ marker: "S1", sourceId: "source-1", sourceName: "Fixture",
        weight: 1, reward: 0.000001, rationale: "Fixture", itemTitle: "Title with literal {count}", itemUrl: "https://example.org/fixture",
        itemPublishedAt: "2026-10-11T00:30:00Z" }], answer: "Retained original. [S1]", totalSpent: 0.000001,
      totalToCreators: 0.000001, trace: [], createdAt: "2026-10-11T00:30:00.000Z", paymentMode: "offline" };
    const bytes = () => [JSON.stringify(run), canonicalJson(buildResearchReceipt(run, [])), researchReportMarkdown(run, null, []),
      JSON.stringify(remoteResearchResult(run)), JSON.stringify(keryxMeta(run)),
      toCsv(["at", "micros", "amount"], [{ at: run.createdAt, micros: "1", amount: run.totalSpent }]),
      ...(["bibtex", "ris", "csl-json"] as const).map(format => JSON.stringify(buildCitationExport(run.citations, format)))];
    const original = bytes();
    for (const locale of ["en", "vi", "pt", "es", "zh-Hans"] as DisplayLocale[]) {
      formatAmount("1", { denomination: "USDC" }, locale); formatNumber(12345.5, {}, locale);
      renderToStaticMarkup(createElement(DisplayTime, { value: run.createdAt, locale, timeZone: "Asia/Ho_Chi_Minh" }));
      expect(bytes()).toEqual(original);
    }
  });
});
