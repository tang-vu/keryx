import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AnswerCard } from "../../components/keryx/answer-card";
import { AnswerEvidenceStatus } from "../../components/keryx/answer-evidence-status";
import { validatePrivacyRun } from "../run-privacy/contracts";
import { buildResearchReceipt } from "../research-receipt";
import { presentationRun } from "./presentation.test-fixture";
import { buildAnswerEvidenceStatus } from "./answer-evidence-status";

const id = "4a04b7c4-1f63-4d73-8f29-611d240b6d74";
const message = "Final coverage assessment — The available excerpt supports the definition, but the requested failure behaviour is not established.";
const final = (text: unknown = message, sufficient: unknown = false, marker: unknown = true) =>
  ({ phase: "sufficiency", ts: 1, message: text, detail: { final: marker, sufficient } });
function admitted(trace: unknown[] = [final()], changes: Record<string, unknown> = {}) {
  return validatePrivacyRun(JSON.parse(JSON.stringify({ ...presentationRun(), id, trace, ...changes })), id);
}
function statusHtml(run = admitted(), allowPublicFollowUp = false) {
  return renderToStaticMarkup(createElement(AnswerEvidenceStatus, { run, allowPublicFollowUp }));
}

it("exposes the recorded incomplete final message without changing targets, estimates or the original", () => {
  const run = admitted(), before = JSON.stringify(run), status = buildAnswerEvidenceStatus(run);
  expect(status.finalAssessment).toEqual({ message, truncated: false });
  expect(status.withExcerpts).toBe(1);expect(status.needsInspection).toBe(0);expect(status.targets[0].estimate).toBe(0.8);
  const dom = new JSDOM(statusHtml(run));try {
    const note = dom.window.document.querySelector('[role="note"][aria-label="Sufficiency"]');
    expect(note?.textContent).toBe(message);expect(note?.querySelector("p")?.getAttribute("lang")).toBe("und");
    expect(note?.querySelector("p")?.getAttribute("dir")).toBe("auto");expect(dom.window.document.body.textContent).toContain("do not establish a complete or factually correct answer");
  } finally { dom.window.close(); }
  expect(JSON.stringify(run)).toBe(before);
});
it("uses the last recorded final rather than sorting untrusted timestamps", () => {
  const run = admitted([{ ...final("OLDER_FINAL_MUST_NOT_REVIVE"), ts: 900 }, { ...final(), ts: 2 }]);
  expect(buildAnswerEvidenceStatus(run).finalAssessment?.message).toBe(message);expect(statusHtml(run)).not.toContain("OLDER_FINAL_MUST_NOT_REVIVE");
});
it("does not let later intermediate or unrelated phase entries erase the last final", () => {
  const run = admitted([final(), null, 17, "opaque", [], { phase: "sufficiency", message: "INTERMEDIATE", detail: { sufficient: false } },
    final("INTERMEDIATE_EXPLICIT", false, false), { ...final("OTHER_PHASE"), phase: "synthesize" }]);
  expect(buildAnswerEvidenceStatus(run).finalAssessment?.message).toBe(message);
});

const suppressors: { name: string; step: unknown }[] = [
  { name: "complete final", step: final("A later complete assessment", true) },
  ...[null, false, 0, {}, [], { toString: "MUST_NOT_COERCE" }, "", " \n\t "].map(value => ({ name: `invalid message ${JSON.stringify(value)}`, step: final(value) })),
  ...[undefined, null, "false", 0, {}].map(value => ({ name: `invalid sufficient ${JSON.stringify(value)}`, step: { ...final("MALFORMED_LATEST"), detail: { final: true, sufficient: value } } })),
  ...[null, "true", 1, {}].map(value => ({ name: `invalid final marker ${JSON.stringify(value)}`, step: final("MALFORMED_MARKER", false, value) })),
];
it.each(suppressors)("withholds $name without reviving an older gap message", ({ step }) => {
  const run = admitted([final("OLDER_FINAL_MUST_NOT_REVIVE"), step]);
  expect(buildAnswerEvidenceStatus(run).finalAssessment).toBeUndefined();
  const dom = new JSDOM(statusHtml(run));try {
    expect(dom.window.document.querySelector('[role="note"][aria-label="Sufficiency"]')).toBeNull();
    expect(dom.window.document.body.textContent).not.toContain("OLDER_FINAL_MUST_NOT_REVIVE");
  } finally { dom.window.close(); }
});
it("omits the optional note when no final assessment exists and preserves existing target inspection", () => {
  const run = admitted([null, "opaque", { phase: "sufficiency", detail: { sufficient: false }, message: "Not declared final" }]);
  expect(buildAnswerEvidenceStatus(run).finalAssessment).toBeUndefined();expect(statusHtml(run)).toContain("Targets with inspectable excerpts: 1/1.");
});
it("keeps a retained incomplete assessment inspectable without inventing absent target or ledger data", () => {
  const run = admitted([final()], { subClaims: [], evidence: undefined, claimCoverage: undefined });
  const status = buildAnswerEvidenceStatus(run);expect(status.targets).toEqual([]);expect(status.finalAssessment?.message).toBe(message);
  const dom = new JSDOM(statusHtml(run));try {
    expect(dom.window.document.querySelector('[role="note"][aria-label="Sufficiency"]')?.textContent).toBe(message);
    expect(dom.window.document.body.textContent).not.toContain("0/");expect(dom.window.document.querySelector("ol")).toBeNull();
  } finally { dom.window.close(); }
});
it("does not invent an assessment-only card when both targets and final metadata are absent", () => {
  const run = admitted([], { subClaims: [], evidence: undefined, claimCoverage: undefined });expect(statusHtml(run)).toBe("");
});
it.each(["High", "Moderate", "Low"] as const)("retains the real report's original %s confidence, prose, money and receipt", level => {
  const run = admitted([final()], { confidence: { level, reason: "Original recorded confidence; not recomputed" } });
  const before = JSON.stringify(run), receipt = JSON.stringify(buildResearchReceipt(run, []));
  const dom = new JSDOM(renderToStaticMarkup(createElement(AnswerCard, { run, meta: null, showFeedback: false })));try {
    expect(dom.window.document.querySelector('[role="note"][aria-label="Sufficiency"]')?.textContent).toBe(message);
    expect([...dom.window.document.querySelectorAll("span")].some(node => node.textContent === level)).toBe(true);
    expect(dom.window.document.body.textContent).toContain("Original recorded confidence; not recomputed");
    expect(dom.window.document.body.textContent).toContain("Exact “quote” <unmodified> & 日本語");
    expect(dom.window.document.body.textContent).toContain("0.000001");
    expect(dom.window.document.body.textContent!.indexOf(message)).toBeLessThan(dom.window.document.body.textContent!.indexOf("Exact “quote”"));
  } finally { dom.window.close(); }
  expect(JSON.stringify(run)).toBe(before);expect(JSON.stringify(buildResearchReceipt(run, []))).toBe(receipt);
});
it.each([false, true])("keeps assessment text out of follow-up URLs and preserves %s public-context authority", allowPublicFollowUp => {
  const text = 'Final coverage assessment — PRIVATE_REASON &run=1 <img src="https://example.invalid/pixel" onerror="alert(1)"> 中文';
  const run = admitted([final(text)]), before = JSON.stringify(run), dom = new JSDOM(statusHtml(run, allowPublicFollowUp));try {
    expect(dom.window.document.querySelector('[role="note"]')?.textContent).toBe(text);expect(dom.window.document.querySelector("img")).toBeNull();
    expect(dom.window.document.querySelector("script")).toBeNull();
    const links = [...dom.window.document.querySelectorAll("a")];expect(links).toHaveLength(allowPublicFollowUp ? 1 : 0);
    for (const link of links) { expect(link.href).not.toContain("PRIVATE_REASON");expect(link.href).not.toContain("pixel");expect(link.href).not.toContain("run=1"); }
    if (!allowPublicFollowUp) expect(dom.window.document.querySelector("button")?.disabled).toBe(true);
  } finally { dom.window.close(); }
  expect(JSON.stringify(run)).toBe(before);
});
it.each([
  { name: "exact bound", text: "x".repeat(4096), expected: "x".repeat(4096), truncated: false },
  { name: "long text", text: "x".repeat(5000), expected: "x".repeat(4095) + "…", truncated: true },
  { name: "surrogate boundary", text: "x".repeat(4094) + "😀" + "tail", expected: "x".repeat(4094) + "…", truncated: true },
])("bounds the $name excerpt without changing the retained original", ({ text, expected, truncated }) => {
  const run = admitted([final(text)]), before = JSON.stringify(run);expect(buildAnswerEvidenceStatus(run).finalAssessment).toEqual({ message: expected, truncated });
  const dom = new JSDOM(statusHtml(run));try { expect(dom.window.document.querySelector('[role="note"]')?.textContent).toBe(expected); } finally { dom.window.close(); }
  expect(JSON.stringify(run)).toBe(before);
});

let browser: Browser, bundle: string;
beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{AnswerEvidenceStatus}from'./components/keryx/answer-evidence-status';
    const root=createRoot(document.getElementById('root'));
    window.renderRecord=(run,allowPublicFollowUp)=>{window.input=run;flushSync(()=>root.render(<AnswerEvidenceStatus run={run} allowPublicFollowUp={allowPublicFollowUp}/>));};
  ` }, bundle: true, minify: true, platform: "browser", format: "iife", jsx: "automatic", write: false, metafile: true,
    define: { "process.env": "{}", "process.env.NODE_ENV": '"production"' } });
  for (const suffix of ["components/keryx/answer-evidence-status.tsx", "lib/research/answer-evidence-status.ts", "lib/research/source-evidence-lens.ts"])
    expect(Object.keys(result.metafile.inputs).some(path => path.replaceAll("\\", "/").endsWith(suffix))).toBe(true);
  expect(Object.keys(result.metafile.inputs).some(path => /^lib\/(?:config|db\/)/.test(path))).toBe(false);
  bundle = result.outputFiles[0].text;browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
it.each([false, true])("renders the actual minified %s public-context note inertly and hides a superseded final", async allowPublicFollowUp => {
  const context = await browser.newContext({ serviceWorkers: "block" }), calls: string[] = [], errors: string[] = [];
  await context.route("**/*", route => {
    if (route.request().isNavigationRequest() && route.request().url() === "https://recorded-assessment.test/") return route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' });
    calls.push(route.request().url());return route.fulfill({ status: 404, body: "" });
  });
  try {
    const page = await context.newPage();page.setDefaultTimeout(4000);page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://recorded-assessment.test/");await page.addScriptTag({ content: bundle });
    const text = 'Final coverage assessment — No support for the requested limit.\n<img src="https://example.invalid/pixel" onerror="window.__injected=true"> 日本語 😀';
    const run = admitted([null, final(text)]), original = JSON.stringify(run);
    await page.evaluate(({ run, allowPublicFollowUp }) => (window as unknown as { renderRecord: (run: unknown, allow: boolean) => void }).renderRecord(run, allowPublicFollowUp), { run, allowPublicFollowUp });
    const note = page.getByRole("note", { name: "Sufficiency", exact: true });await note.waitFor();expect(await note.textContent()).toBe(text);
    expect(await page.locator("img").count()).toBe(0);expect(await page.evaluate(() => (window as unknown as { __injected?: boolean }).__injected)).toBeUndefined();
    expect(await page.evaluate(() => JSON.stringify((window as unknown as { input: unknown }).input))).toBe(original);
    const updated = admitted([final(text), final("Later complete assessment", true)]);
    await page.evaluate(({ run, allowPublicFollowUp }) => (window as unknown as { renderRecord: (run: unknown, allow: boolean) => void }).renderRecord(run, allowPublicFollowUp), { run: updated, allowPublicFollowUp });
    expect(await note.count()).toBe(0);expect(await page.getByText("Targets with inspectable excerpts: 1/1.", { exact: true }).count()).toBe(1);
    expect(await page.evaluate(() => JSON.stringify((window as unknown as { input: unknown }).input))).toBe(JSON.stringify(updated));
    expect(calls).toEqual([]);expect(errors).toEqual([]);expect(page.url()).toBe("https://recorded-assessment.test/");
  } finally { await context.close(); }
});
