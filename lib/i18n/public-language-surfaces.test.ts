import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import type { ArchiveEntry } from "../answers-archive";
import type { QueryRun, PaymentRecord } from "../types";
import type { DispatchReader } from "../history/read-dispatch";
import type { RunPrivacyStore, RunVisibility } from "../run-privacy/contracts";
import type { PresentationLanguage } from "@/shared/i18n/presentation-language";

const fixture = vi.hoisted(() => {
  vi.stubEnv("BASE_URL", "https://synthetic-language.example");
  return { entries: [] as ArchiveEntry[], reader: null as DispatchReader | null };
});
vi.mock("@/lib/answers-archive-cache", () => ({ getArchiveCached: async () => fixture.entries }));
vi.mock("@/lib/db", () => ({ getDb: async () => fixture.reader }));
vi.mock("@/lib/history/testnet-archive", () => ({ getTestnetArchive: async () => null }));
vi.mock("@/lib/run-privacy/auth", () => ({ pagePrivacyActor: async () => undefined }));
vi.mock("@/lib/answers-freshness", () => ({ loadFreshness: async () => null }));
vi.mock("@/lib/hooks/use-siwe-auth", () => ({ useSiweAuth: () => ({ session: null }) }));
vi.mock("@/components/keryx/follow-up-form", () => ({ FollowUpForm: () => null }));
vi.mock("@/lib/wanted-board", () => ({ loadWantedBoard: async () => ({ open: [], filled: [] }), WANTED_DETAIL_LIMIT: 100 }));
vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/keryx/product-guide", () => ({ ProductEntryNote: () => null }));
vi.mock("@/components/keryx/display-time", () => ({ DisplayTime: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("404"); }, redirect: (url: string) => { throw Error(`redirect:${url}`); } }));

import AnswersPage, { generateMetadata as indexMetadata } from "@/app/answers/page";
import AnswersPageN from "@/app/answers/page/[n]/page";
import { GET as feed } from "@/app/answers/feed.xml/route";
import { archiveIndexJsonLd } from "@/app/answers/archive-index-json-ld";
import { paginateArchive } from "../answers-pagination";
import { ArchivePagination } from "@/components/keryx/archive-pagination";
import { ArchiveAnswerRow } from "@/components/keryx/archive-answer-row";
import { AnswerMarkdown } from "@/components/keryx/answer-markdown";
import DispatchPage, { generateMetadata as dispatchMetadata } from "@/app/dispatch/[id]/page";
import { DispatchView } from "@/app/dispatch/[id]/dispatch-view";
import { AnswerCard } from "@/components/keryx/answer-card";
import { recordedAnswerLanguage } from "../research/answer-language-provenance";
import { publicQueryRun } from "../research/public-query-run";
import { SYNTHETIC_EVIDENCE_NOTICE } from "../research/evidence-provenance";
import { cleanText } from "../answers-archive";
import sitemap from "@/app/sitemap";

function entry(id: string, answerLanguage?: string): ArchiveEntry {
  return { id, answerLanguage, question: `${id} question sentinel`, answerSnippet: `${id} answer sentinel`, citationCount: 1,
    totalSpent: 0, toCreators: 0, sourceNames: [], createdAt: "2026-10-12T00:00:00Z", confidence: null };
}
beforeEach(() => { fixture.entries = [entry("vi", "vi"), entry("zh", "zh-Hans"), entry("unknown")]; fixture.reader = null; });
afterAll(() => vi.unstubAllEnvs());

describe("actual public language surfaces", () => {
  it("filters the server archive and its Atom subscription from the same recorded language", async () => {
    const page = await AnswersPage({ searchParams: Promise.resolve({ language: "vi" }) });
    const serialized = JSON.stringify(page);
    expect(serialized).toContain("vi answer sentinel");
    expect(serialized).not.toContain("zh answer sentinel");
    expect(serialized).not.toContain("unknown answer sentinel");
    const response = await feed(new Request("https://synthetic-language.example/answers/feed.xml?language=vi"));
    const xml = await response.text();
    expect(xml).toContain("vi answer sentinel");
    expect(xml).not.toContain("zh answer sentinel");
    expect(xml).not.toContain("unknown answer sentinel");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses ambiguous repeated query preferences consistently across page and feed", async () => {
    const page = await AnswersPage({ searchParams: Promise.resolve({ language: ["vi", "zh-Hans"] }) });
    expect(JSON.stringify(page)).toContain("unknown answer sentinel");
    const xml = await (await feed(new Request("https://synthetic-language.example/answers/feed.xml?language=vi&language=zh-Hans"))).text();
    expect(xml).toContain("unknown answer sentinel");
  });

  it("retains one existing canonical and shipped English alternates while filtered views stay nonindexed", async () => {
    const plain = await indexMetadata({ searchParams: Promise.resolve({}) });
    const filtered = await indexMetadata({ searchParams: Promise.resolve({ language: "vi" }) });
    expect(filtered.alternates).toEqual(plain.alternates);
    expect(filtered.alternates?.canonical).toBe("/answers");
    expect(filtered.robots).toEqual({ index: false, follow: true });
    const routes = await sitemap();
    expect(routes.filter(row => row.url.includes("/dispatch/")).map(row => row.url)).toHaveLength(3);
    expect(routes.every(row => !row.url.includes("?language=") && !/^\/(vi|zh-Hans)(\/|$)/.test(new URL(row.url).pathname))).toBe(true);
  });

  it("retains page-one route continuity and language selection without a redirect loop", async () => {
    await expect(AnswersPageN({ params: Promise.resolve({ n: "1" }), searchParams: Promise.resolve({ language: "vi" }) }))
      .rejects.toThrow("redirect:/answers?language=vi");
    const nav = renderToStaticMarkup(createElement(ArchivePagination, { page: 2, totalPages: 3, language: "vi" }));
    expect(nav).toContain('href="/answers?language=vi"');
    expect(nav).toContain('href="/answers/page/3?language=vi"');
  });

  it("places the recorded tag on answer snippets and answer works, keeping unknown questions separate", () => {
    const html = renderToStaticMarkup(createElement(ArchiveAnswerRow, { entry: fixture.entries[0] }));
    expect(html).toContain('<h2 lang="und"');
    expect(html).toContain('<p lang="vi"');
    const collection = archiveIndexJsonLd({ base: "https://synthetic-language.example", url: "/answers", name: "Archive",
      slice: paginateArchive(fixture.entries, 1), totalEntries: 3 });
    expect(collection.inLanguage).toBe("en");
    const rows = (collection.mainEntity as { itemListElement: Array<{ item?: { inLanguage?: string } }> }).itemListElement;
    expect(rows[0].item?.inLanguage).toBe("vi");
    expect(rows[1].item?.inLanguage).toBe("zh-Hans");
    expect(rows[2].item).toBeUndefined();
  });

  it("keeps verbatim quotation outside recorded generated-prose language without changing bytes", () => {
    const text = 'Generated sentence. Source text: “Original “nested” quotation” [S1]';
    const html = renderToStaticMarkup(createElement(AnswerMarkdown, { text, citations: [], language: "vi" }));
    expect(html).toContain('<div lang="vi"');
    expect(html).toContain('<span lang="und">“Original');
    expect(html).toContain('Original “nested” quotation');
    expect(html).toContain('<button lang="en"');
    expect(renderToStaticMarkup(createElement(AnswerMarkdown, { text, citations: [] }))).toContain('<div lang="und"');
  });
});

// Synthetic retained terminal packets: never invoke the producer/finalizer.
function retainedPacket(answer: string, language: string = "vi") {
  return { format: "keryx-answer-language-v1", scope: "generated-prose", language,
    method: "deterministic-renderer", answerSha256: `0x${createHash("sha256").update(answer, "utf8").digest("hex")}` };
}
function terminal(packet: unknown): QueryRun["trace"][number] {
  return { phase: "done", ts: 0, message: "Synthetic retained terminal packet", detail: { answerLanguage: packet } };
}
function retainedRun(language: PresentationLanguage = "vi"): QueryRun {
  const answer = "## Bản tổng hợp được ghi lại\n\nGenerated prose sentinel. “Original “nested” quotation” [S1]";
  return { id: "synthetic-dom-dispatch", question: "Câu hỏi gốc bằng tiếng Việt?", budget: 0.5,
    engine: "llm:synthetic-machine-id", subClaims: [], decisions: [], citations: [], answer,
    trace: [terminal(retainedPacket(answer, language))], createdAt: "2026-10-12T00:00:00Z",
    totalSpent: 0.123456, totalToCreators: 0.012345, paymentMode: "real", settledPayments: 0, pendingPayments: 1 };
}
function installDispatch(value: QueryRun, visibility: RunVisibility = "public", payments: PaymentRecord[] = []) {
  const reader = {
    runPrivacyActive: true,
    runPrivacy: { read: vi.fn(async () => ({ exists: true, item: visibility === "private" ? null :
      { run: value, state: { visibility, revision: 0, erased: false } } })) } as unknown as RunPrivacyStore,
    getQueryRun: vi.fn(async () => value), listFollowUps: vi.fn(async () => [] as QueryRun[]),
    listPaymentsByQuery: vi.fn(async () => payments.filter(row => row.kind === "citation")),
    listCreatorPaymentAttemptsByQuery: vi.fn(async () => payments),
  } satisfies DispatchReader;
  fixture.reader = reader;
  return reader;
}
const dispatchParams = () => ({ params: Promise.resolve({ id: "synthetic-dom-dispatch" }) });
const generatedLanguage = (html: string) => html.match(/<div lang="([^"]+)" class="space-y-5 font-serif/)?.[1];
async function renderDispatch(value: QueryRun) {
  installDispatch(value);
  return renderToStaticMarkup(await DispatchPage(dispatchParams()));
}

const quoteCases = [
  {
    name: "ordinary bold, emphasis and backticks", tag: "p",
    source: 'Generated before. “Original **English** and *italic* and `code` tail” generated after. [S1]',
    displayed: 'Generated before. “Original English and italic and code tail” generated after. [1]',
    original: '“Original English and italic and code tail”',
    formats: { strong: "English", em: "italic", code: "code" },
  },
  {
    name: "answer-grounding U+200B emphasis, backticks and literal source marker", tag: "p",
    // Literal retained bytes from answer-grounding's separators; no producer invocation.
    source: 'Generated before. “Original *\u200bEnglish*\u200b and `\u200bcode`\u200b [\u200bS1] tail” generated after. [S1]',
    displayed: 'Generated before. “Original \u200bEnglish\u200b and \u200bcode\u200b [\u200bS1] tail” generated after. [1]',
    original: '“Original \u200bEnglish\u200b and \u200bcode\u200b [\u200bS1] tail”',
    formats: { em: "\u200bEnglish", code: "\u200bcode" },
  },
  {
    name: "citation splitting inside an original", tag: "p",
    source: 'Generated before. “Original *English* [S1] `code` tail” generated after. [S2]',
    displayed: 'Generated before. “Original English [1] code tail” generated after. [2]',
    original: '“Original English [1] code tail”',
    formats: { em: "English", code: "code" },
  },
  {
    name: "adjacent quotes retain their conservative widest span", tag: "p",
    source: 'Generated before. “First *English*” bridge “Second `code`” generated after. [S1]',
    displayed: 'Generated before. “First English” bridge “Second code” generated after. [1]',
    original: '“First English” bridge “Second code”',
    formats: { em: "English", code: "code" },
  },
  {
    name: "nested quotes", tag: "p",
    source: 'Generated before. “Original “nested *English*” and `code` tail” generated after. [S1]',
    displayed: 'Generated before. “Original “nested English” and code tail” generated after. [1]',
    original: '“Original “nested English” and code tail”',
    formats: { em: "English", code: "code" },
  },
  {
    name: "unclosed quote retains its original tail", tag: "p",
    source: 'Generated before. “Original *English* and `code` tail [S1]',
    displayed: 'Generated before. “Original English and code tail [1]',
    original: '“Original English and code tail [1]',
    formats: { em: "English", code: "code" },
  },
  {
    name: "formatting crossing both quotation boundaries", tag: "p",
    source: '**Generated before. “Original English” generated after.** [S1]',
    displayed: 'Generated before. “Original English” generated after. [1]',
    original: '“Original English”',
    formats: { strong: 'Generated before. “Original English” generated after.' },
  },
  {
    name: "answer-grounding U+200B topic in a heading", tag: "h2",
    source: '### Generated topic: “Original `\u200bcode`\u200b” generated after. [S1]',
    displayed: 'Generated topic: “Original \u200bcode\u200b” generated after. [1]',
    original: '“Original \u200bcode\u200b”',
    formats: { code: "\u200bcode" },
  },
];

function expectQuoteLanguages(html: string, quote: typeof quoteCases[number], language: string) {
  const dom = new JSDOM(html);
  try {
    const answer = dom.window.document.querySelector('div[class^="space-y-5 font-serif"]')!;
    expect(answer.getAttribute("lang")).toBe(language);
    const body = answer.querySelector(quote.tag)!;
    expect(body.textContent).toBe(quote.displayed);
    const start = quote.displayed.indexOf(quote.original);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = start + quote.original.length;
    const walker = dom.window.document.createTreeWalker(body, dom.window.NodeFilter.SHOW_TEXT);
    let offset = 0;
    let originalText = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      const effective = node.parentElement?.closest("[lang]")?.getAttribute("lang");
      const citation = node.parentElement?.closest("button");
      const from = Math.max(start, offset), to = Math.min(end, offset + text.length);
      if (to > from) {
        originalText += text.slice(from - offset, to - offset);
        expect(effective, `${quote.name}: original fragment ${text}`).toBe(citation ? "en" : "und");
      }
      if (offset < start || offset + text.length > end) {
        expect(effective, `${quote.name}: generated fragment ${text}`).toBe(citation ? "en" : language);
      }
      offset += text.length;
    }
    // Account for every displayed character, including inline descendants and quote tails.
    expect(originalText).toBe(quote.original);
    expect(offset).toBe(quote.displayed.length);
    for (const [tag, text] of Object.entries(quote.formats)) {
      expect(body.querySelector(tag)?.textContent).toBe(text);
    }
    const buttons = Array.from(body.querySelectorAll("button"));
    expect(buttons).toHaveLength(quote.name === "citation splitting inside an original" ? 2 : 1);
    for (const button of buttons) {
      expect(button.closest("[lang]")?.getAttribute("lang")).toBe("en");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("aria-label")).toBeTruthy();
    }
  } finally { dom.window.close(); }
}

describe("recorded generated-prose DOM caller chain", () => {
  it.each(["en", "vi", "pt", "es"] as const)("transfers exact retained %s bytes through the page and both real callers", async language => {
    const value = retainedRun(language);
    expect(recordedAnswerLanguage(value)).toBe(language);
    const before = JSON.stringify(value);
    const html = await renderDispatch(value);
    expect(generatedLanguage(html)).toBe(language);
    expect(html).toContain("Generated prose sentinel.");
    expect(html).toContain('<p lang="und"');
    expect(html).toContain('<span lang="und">“Original “nested” quotation”</span>');
    expect(html).toContain('<button lang="en"');
    expect(html).toContain("Archived dispatch");
    expect(html).toContain("The reading");
    expect(html).toContain('aria-label="Payment evidence"');
    const metadata = await dispatchMetadata(dispatchParams());
    expect(metadata.other?.["DC.language"]).toBe(language);
    expect(JSON.stringify(value)).toBe(before);
  });

  it.each(quoteCases.flatMap(quote => (["vi", "pt", "es"] as const).map(language => ({ ...quote, language }))))(
    "keeps the full $name original undetermined in recorded $language through the real page chain", async quote => {
      const value = { ...retainedRun(quote.language), answer: quote.source,
        trace: [terminal(retainedPacket(quote.source, quote.language))] };
      const before = JSON.stringify(value);
      expect(recordedAnswerLanguage(value)).toBe(quote.language);
      expectQuoteLanguages(await renderDispatch(value), quote, quote.language);
      expect(JSON.stringify(value)).toBe(before);
    });

  it("keeps the grounded inline quote and generated prose undetermined without a retained packet", async () => {
    const quote = quoteCases[1];
    const value = { ...retainedRun(), answer: quote.source, trace: [] };
    expect(recordedAnswerLanguage(value)).toBeUndefined();
    expectQuoteLanguages(await renderDispatch(value), quote, "und");
  });

  const refused: Array<[string, (value: QueryRun) => QueryRun]> = [
    ["missing", value => ({ ...value, trace: [] })],
    ["conflicting", value => ({ ...value, trace: [...value.trace, terminal(retainedPacket(value.answer, "es"))] })],
    ["changed final bytes", value => ({ ...value, answer: `${value.answer}\nChanged bytes.` })],
    ["duplicate", value => ({ ...value, trace: [...value.trace, value.trace[0]] })],
    ["malformed digest", value => ({ ...value, trace: [terminal({ ...retainedPacket(value.answer), answerSha256: "not-a-digest" })] })],
    ["extra packet field", value => ({ ...value, trace: [terminal({ ...retainedPacket(value.answer), requestedLanguage: "vi" })] })],
    ["unknown language", value => ({ ...value, trace: [terminal(retainedPacket(value.answer, "zh-Hans"))] })],
    ["future packet", value => ({ ...value, trace: [terminal({ ...retainedPacket(value.answer), format: "keryx-answer-language-v2" })] })],
    ["null packet", value => ({ ...value, trace: [terminal(null)] })],
    ["nonterminal packet", value => ({ ...value, trace: [{ ...terminal(retainedPacket(value.answer)), phase: "synthesize" }] })],
    ["cleaned-body digest", value => ({ ...value, trace: [terminal(retainedPacket(cleanText(value.answer)))] })],
    ["truncated-body digest", value => ({ ...value, trace: [terminal(retainedPacket(value.answer.slice(0, 40)))] })],
  ];
  it.each(refused)("keeps %s provenance undetermined in the actual page DOM", async (_name, change) => {
    const value = change(retainedRun());
    expect(recordedAnswerLanguage(value)).toBeUndefined();
    const html = await renderDispatch(value);
    expect(generatedLanguage(html)).toBe("und");
    expect(html).toContain("Generated prose sentinel.");
    expect(html).not.toContain('"inLanguage"');
    expect((await dispatchMetadata(dispatchParams())).other?.["DC.language"]).toBe("und");
  });

  it("does not derive DOM authority from requested language, question, engine, history or projected trace", () => {
    const value = { ...retainedRun(), trace: [{ phase: "done" as const, ts: 0, message: "Synthetic request hints",
      detail: { requestedLanguage: "vi", answerLocale: "vi", language: "vi" } }] };
    expect(recordedAnswerLanguage(value)).toBeUndefined();
    const html = renderToStaticMarkup(createElement(DispatchView, { run: publicQueryRun(value), payments: [],
      historical: true, historicalNetwork: "eip155:5042002" }));
    expect(generatedLanguage(html)).toBe("und");
    // Even a retained-looking public trace is not independently read by the browser caller.
    const projected = publicQueryRun(retainedRun());
    expect(generatedLanguage(renderToStaticMarkup(createElement(DispatchView, { run: projected, payments: [] })))).toBe("und");
    expect(generatedLanguage(renderToStaticMarkup(createElement(AnswerCard, { run: projected, meta: null })))).toBe("und");
  });

  it("invalidates the tag when the existing synthetic-evidence projection changes the answer", async () => {
    const value = retainedRun();
    value.citations = [{ marker: "S1", sourceId: "synthetic-source", sourceName: "Synthetic original",
      weight: 1, reward: 0, evidenceProvenance: "synthetic-demo" }];
    expect(recordedAnswerLanguage(value)).toBe("vi");
    const html = await renderDispatch(value);
    expect(new JSDOM(html).window.document.body.textContent).toContain(SYNTHETIC_EVIDENCE_NOTICE);
    expect(generatedLanguage(html)).toBe("und");
    expect(value.answer).not.toContain(SYNTHETIC_EVIDENCE_NOTICE);
  });

  it("preserves English shell, financial fields and machine values while changing only the answer tag", () => {
    const value = retainedRun();
    const payments: PaymentRecord[] = [{ kind: "operating-fee", queryId: value.id, sourceId: "synthetic-fee",
      sourceName: "Synthetic fee", payer: `0x${"1".repeat(40)}`, payee: `0x${"2".repeat(40)}`,
      amountUsdc: 0.000001, txHash: "synthetic_reference_123", network: "eip155:5042",
      settled: false, settlementStatus: "pending" }];
    const before = JSON.stringify({ value, payments });
    const run = publicQueryRun(value);
    const html = renderToStaticMarkup(createElement(DispatchView, { run, payments, answerLanguage: recordedAnswerLanguage(value) }));
    const unknown = renderToStaticMarkup(createElement(DispatchView, { run, payments }));
    expect(html.replace('<div lang="vi"', '<div lang="und"')).toBe(unknown);
    expect(html).toContain("$0.123456");
    expect(html).toContain("0.000001");
    expect(html).toContain("synthetic_reference_123");
    expect(html).toContain(value.engine);
    expect(html).toContain("Spent");
    expect(html).toContain("To creators");
    expect(html).toContain("Pending proof");
    expect(JSON.stringify({ value, payments })).toBe(before);
  });

  it.each(["private", "unlisted"] as const)("refuses public language metadata for %s visibility without leaking originals", async visibility => {
    const value = { ...retainedRun(), question: "Hidden question sentinel", answer: "Hidden answer sentinel" };
    value.trace = [terminal(retainedPacket(value.answer))];
    const reader = installDispatch(value, visibility);
    const metadata = await dispatchMetadata(dispatchParams());
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.other?.["DC.language"]).toBeUndefined();
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain(value.question);
    expect(serialized).not.toContain(value.answer);
    expect(serialized).not.toContain("answerSha256");
    if (visibility === "private") {
      await expect(DispatchPage(dispatchParams())).rejects.toThrow("404");
      expect(reader.getQueryRun).not.toHaveBeenCalled();
      expect(reader.listCreatorPaymentAttemptsByQuery).not.toHaveBeenCalled();
    } else {
      // Existing unlisted permalink access is retained; it cannot publish public JSON-LD.
      const html = renderToStaticMarkup(await DispatchPage(dispatchParams()));
      expect(html).not.toContain('type="application/ld+json"');
    }
  });
});
