import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import sample from "@/docs/research-evidence-audit-example.json";
import { evidenceAuditCopy } from "@/locales/en/evidence-audit";
import vi from "@/locales/generated/vi-ui-preview";
import zh from "@/locales/generated/zh-Hans-ui-preview";
import { emptyUiPreview, previewCopy, previewText } from "../i18n/ui-preview";
import { auditResearchEvidence } from "./evidence-audit";
import { browserSha256 } from "../browser-receipt-integrity";
import { canonicalJson } from "../canonical-json";

const previews = { en: emptyUiPreview, vi, "zh-Hans": zh };
type Locale = keyof typeof previews;
type Fixture = { locale(value: Locale): void };
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{ResearchEvidenceAuditWorkspace}from'./components/keryx/research-evidence-audit';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import vi from'./locales/generated/vi-ui-preview';import zh from'./locales/generated/zh-Hans-ui-preview';
    const root=createRoot(document.getElementById('root')),previews={en:{},vi,'zh-Hans':zh};window.fixture={locale(locale){root.render(<UiCopyContext.Provider value={{...englishUiCopy,locale,preview:previews[locale]}}><ResearchEvidenceAuditWorkspace/></UiCopyContext.Provider>)}};window.fixture.locale('en');` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
it.each((Object.keys(previews) as Locale[]).flatMap(locale => [true, false].map(known => ({ locale, known }))))("renders current $locale cost ratios with known=$known using actual audit arithmetic", async ({ locale, known }) => {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://audit-locale.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://audit-locale.test/"); await page.addScriptTag({ content: bundle });
    await page.getByLabel(evidenceAuditCopy.input, { exact: true }).waitFor(); await page.evaluate(locale => (window as unknown as { fixture: Fixture }).fixture.locale(locale), locale);
    const input = structuredClone(sample);
    if (known) {
      Object.assign(input.receipt.payload.settlement, { mode: "real", ledgerCompleteness: "complete", expectedRecordedPaymentsAtFinish: 1 });
      Object.assign(input.receipt.payload.settlement.creatorPayments[0], { status: "settled", circleTransferId: "synthetic-ratio-fixture" });
      Object.assign(input.costs, { llm: { status: "estimated", amountMicroUsd: "900719925474099300", reference: "synthetic-llm" }, search: { status: "estimated", amountMicroUsd: "1", reference: "synthetic-search" }, other: { status: "estimated", amountMicroUsd: "0", reference: "synthetic-other" } });
      input.receipt.integrity.digest = await browserSha256(canonicalJson(input.receipt.payload)); input.costs.receiptDigest = input.review.receiptDigest = input.receipt.integrity.digest;
    }
    const raw = JSON.stringify(input), audit = await auditResearchEvidence(raw, {}), localized = previewCopy(previews[locale], "evidence-audit", evidenceAuditCopy);
    expect(audit.economics.sourceCostPerSupportedClaim?.numeratorMicros ?? null).toBe(known ? "2000" : null);
    expect(audit.economics.providerCostPerSupportedClaim?.numeratorMicros ?? null).toBe(known ? "900719925474099301" : null);
    await page.getByLabel(localized.input, { exact: true }).fill(raw); await page.getByRole("button", { name: localized.check, exact: true }).click(); await page.getByRole("heading", { name: localized.result, exact: true }).waitFor();
    for (const active of [locale, locale === "en" ? "vi" : "en"] as Locale[]) {
      await page.evaluate(locale => (window as unknown as { fixture: Fixture }).fixture.locale(locale), active); const copy = previewCopy(previews[active], "evidence-audit", evidenceAuditCopy);
      await page.getByRole("heading", { name: copy.result, exact: true }).waitFor();
      for (const [label, ratio, unit] of [[copy.sourceRatio, audit.economics.sourceCostPerSupportedClaim, "USDC"], [copy.providerRatio, audit.economics.providerCostPerSupportedClaim, "USD"]] as const) {
        const template = previewText(previews[active], "${amount} micro-${unit} / ${count} supported claims", ["evidence-audit"]);
        const expected = ratio ? template.replace(/\$\{(amount|unit|count)\}/g, (_match, key: "amount" | "unit" | "count") => String({ amount: ratio.numeratorMicros, unit, count: ratio.denominatorSupportedClaims }[key])) : copy.unknown;
        expect(await page.getByText(label, { exact: true }).locator("..").locator("dd").textContent()).toBe(expected);
      }
    }
    expect(errors).toEqual([]); expect(requests).toEqual(["https://audit-locale.test/"]); expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally { await context.close(); }
});
