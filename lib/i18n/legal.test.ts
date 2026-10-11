import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { createMessages, englishMessages, validateMessageCatalogue } from "./messages";
import { createRichMessages } from "./rich-messages";
import { legalMessages } from "@/locales/en/legal";

const require = createRequire(path.join(process.cwd(), "package.json"));
const evidenceDirectory = process.env.KERYX_LEGAL_RENDER_EVIDENCE;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const frozen = JSON.parse(readFileSync("fixtures/i18n/legal-pages-v1.json", "utf8")) as {
  sourceCommit: string; sources: Record<"privacy" | "terms", { source: string; sha256: string }>;
  baselineHeader: { schemaVersion: number; sourceCommit: string; parserVersion: string }; outsideBaselineSha256: string;
};
async function compiledPage(area: "privacy" | "terms", phase: "base" | "candidate", network: "arc" | "arcTestnet") {
  const file = `app/${area}/page.tsx`;
  // This small committed fixture is the canonical original legal source, so a
  // fresh/shallow CI checkout never depends on ignored local evidence or Git history.
  const source = phase === "base" ? frozen.sources[area].source : readFileSync(file, "utf8");
  if (phase === "base") expect(hash(source)).toBe(frozen.sources[area].sha256);
  const result = await build({ stdin: { contents: "export { default, metadata } from 'legal-page-fixture';", loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react/jsx-runtime", "next/link"],
    plugins: [{ name: "legal-page-render-boundaries", setup(builder) {
      builder.onResolve({ filter: /^legal-page-fixture$/ }, () => ({ path: file, namespace: "page-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "page-fixture" }, () => ({ contents: source, loader: "tsx", resolveDir: path.resolve(path.dirname(file)) }));
      builder.onResolve({ filter: /^@\/components\/keryx\/site-(header|footer)$/ }, args => ({ path: args.path.endsWith("header") ? "header" : "footer", namespace: "shell-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "shell-fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        `import React from 'react';export function Site${args.path === "header" ? "Header" : "Footer"}(){return <${args.path === "header" ? "header" : "footer"} data-fixture="unchanged-shell"/>}` }));
    } }], define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify(network), "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" } });
  const compiledModule = { exports: {} as { default: () => ReturnType<typeof createElement>; metadata: unknown } };
  vm.runInNewContext(result.outputFiles[0].text, { module: compiledModule, exports: compiledModule.exports, require, console }, { timeout: 2000 });
  return { ...compiledModule.exports, source, compiled: result.outputFiles[0].text };
}

describe("exact English legal page catalogue", () => {
  it("registers the complete dedicated source and keeps legal authority English", () => {
    expect(Object.keys(legalMessages)).toHaveLength(73);
    expect(validateMessageCatalogue(englishMessages)).toEqual({ missing: [], invalid: [] });
    for (const [key, value] of Object.entries(legalMessages)) expect(englishMessages[key as keyof typeof legalMessages]).toBe(value);
    expect(createMessages("en")("legal.privacy.metadataTitle")).toBe("Privacy — Keryx");
    expect(createMessages("en")("legal.terms.metadataTitle")).toBe("Terms of service — Keryx");
  });
  for (const network of ["arc", "arcTestnet"] as const) for (const area of ["privacy", "terms"] as const) {
    it(`${area} on ${network} retains complete markup, metadata, headings and link actions`, async () => {
      const [base, candidate] = await Promise.all([compiledPage(area, "base", network), compiledPage(area, "candidate", network)]);
      const before = renderToStaticMarkup(createElement(base.default)), after = renderToStaticMarkup(createElement(candidate.default));
      expect(after).toBe(before); expect(candidate.metadata).toEqual(base.metadata);
      expect((after.match(/<main\b/g) ?? []).length).toBe(1); expect((after.match(/<h1\b/g) ?? []).length).toBe(1);
      expect((after.match(/<h2\b/g) ?? []).length).toBe(area === "privacy" ? 11 : 6);
      const links = (html: string) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)].map(match => match[0]);
      expect(links(after)).toEqual(links(before));
      expect(links(after).some(link => link.includes('href="mailto:vutang2212@gmail.com"'))).toBe(true);
      expect(after).not.toContain("[object Object]"); expect(after).not.toContain("<script");
      if (area === "privacy") expect(after.includes("Mainnet sessions retain an encrypted signing key")).toBe(network === "arc");
      if (evidenceDirectory) {
        mkdirSync(evidenceDirectory, { recursive: true });
        const label = `${area}-${network}`;
        writeFileSync(path.join(evidenceDirectory, `${label}-base.html`), before, { flag: "wx" });
        writeFileSync(path.join(evidenceDirectory, `${label}-candidate.html`), after, { flag: "wx" });
        writeFileSync(path.join(evidenceDirectory, `${label}.json`), JSON.stringify({ area, network, exactHtml: true, exactMetadata: true,
          baseSourceSha256: hash(base.source), candidateSourceSha256: hash(candidate.source), htmlSha256: hash(after),
          baseCompiledSha256: hash(base.compiled), candidateCompiledSha256: hash(candidate.compiled), metadata: candidate.metadata,
          links: links(after), boundary: "Actual legal page, real React/Next Link, unchanged shell fixtures, actual pinned network helper. No CSS/pixel/Next boot acceptance." }, null, 2) + "\n", { flag: "wx" });
      }
    });
  }
  it("escapes named text and rich values while retaining the reviewed emphasis node", () => {
    const rich = createRichMessages("en"), message = createMessages("en");
    const rendered = renderToStaticMarkup(createElement("p", null, rich("legal.privacy.shortVersion.summary", {
      network: "<script>{publishedNotice}", publishedNotice: createElement("strong", { className: "text-ink" }, message("legal.privacy.shortVersion.publicNotice")),
    })));
    expect(rendered).toContain("&lt;script&gt;{publishedNotice}"); expect(rendered).toContain('<strong class="text-ink">Public research is published.</strong>');
    expect(rendered).not.toContain("<script>");
    expect(message("legal.privacy.updated", { date: "<date>{network}" })).toContain("<date>{network}");
  });
  it("has only original protocol/contact data inline and retires no unrelated allowances", async () => {
    const { extractUiCopy } = await import("../../scripts/check-ui-copy.mjs");
    const privacy = extractUiCopy("app/privacy/page.tsx", readFileSync("app/privacy/page.tsx", "utf8")).map(item => item.text);
    const terms = extractUiCopy("app/terms/page.tsx", readFileSync("app/terms/page.tsx", "utf8")).map(item => item.text);
    expect(privacy).toEqual(["/dispatch/…", "https://keryx.cc", "chrome.storage.local", "vutang2212@gmail.com"]);
    expect(terms).toEqual(["vutang2212@gmail.com"]);
    const baseline = JSON.parse(readFileSync("locales/ui-copy-baseline.json", "utf8"));
    const outside = (values: { file: string }[]) => values.filter(value => !["app/privacy/page.tsx", "app/terms/page.tsx"].includes(value.file));
    expect(hash(JSON.stringify(outside(baseline.entries)))).toBe(frozen.outsideBaselineSha256);
    expect({ schemaVersion: baseline.schemaVersion, sourceCommit: baseline.sourceCommit, parserVersion: baseline.parserVersion }).toEqual(frozen.baselineHeader);
    expect(baseline.entries.filter((value: { file: string }) => ["app/privacy/page.tsx", "app/terms/page.tsx"].includes(value.file))).toHaveLength(5);
  });
});
