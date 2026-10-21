import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { ArchiveAnswerRow } from "../components/keryx/archive-answer-row";
import {
  archiveAnswerSnippet,
  buildArchive,
  buildArchiveStream,
  extractiveAnswerPreview,
  metadataAnswerExcerpt,
  normalizeQuestion,
  cleanText,
  relatedAnswers,
  searchTerm,
  type ArchiveEntry,
} from "./answers-archive";
import { confidenceBanner } from "./research/confidence-copy";
import { buildAnswersFeedXml } from "./answers-feed";
import { archiveIndexJsonLd } from "../app/answers/archive-index-json-ld";
import { paginateArchive } from "./answers-pagination";
import type { QueryRun } from "./types";
import type { PresentationLanguage } from "../shared/i18n/presentation-language";

function run(over: Partial<QueryRun>): QueryRun {
  return {
    id: "r1",
    question: "What is x402?",
    budget: 0.05,
    engine: "llm:claude",
    subClaims: [],
    decisions: [],
    citations: [{ marker: "S1", sourceId: "s1", sourceName: "Latent Space", weight: 1, reward: 0.001, rationale: "" }],
    answer: "x402 is an HTTP payment scheme [S1].",
    totalSpent: 0.01,
    totalToCreators: 0.005,
    trace: [],
    createdAt: "2026-07-10T00:00:00.000Z",
    ...over,
  };
}

// Synthetic stored envelopes only; these tests never invoke the language producer.
function recorded(over: Partial<QueryRun>, language: PresentationLanguage): QueryRun {
  const value = run(over);
  return { ...value, trace: [{ phase: "done", ts: 0, message: "Synthetic terminal provenance", detail: {
    answerLanguage: { format: "keryx-answer-language-v1", scope: "generated-prose", language,
      method: "deterministic-renderer", answerSha256: `0x${createHash("sha256").update(value.answer, "utf8").digest("hex")}` },
  } }] };
}

describe("normalizeQuestion", () => {
  it("lowercases, collapses whitespace, strips trailing punctuation", () => {
    expect(normalizeQuestion("  What  is  x402? ")).toBe("what is x402");
    expect(normalizeQuestion("What is x402")).toBe("what is x402");
  });
});

describe("cleanText", () => {
  it("removes citation markers and markdown", () => {
    expect(cleanText("It is **bold** and cited [S1] `code`.")).toBe("It is bold and cited code.");
  });
});

describe("buildArchive", () => {
  it("keeps a winner per normalized question and recorded generated-prose language in both scans", async () => {
    const vietnamese = recorded({ id: "vi-thin", question: "  WHAT is x402?! ", answer: "Synthetic generated prose. “Original topic”" }, "vi");
    const rich = { ...vietnamese, id: "vi-rich", citations: [...vietnamese.citations, { ...vietnamese.citations[0], marker: "S2" }] };
    const paid = { ...rich, id: "vi-paid", totalToCreators: 0.006 };
    const newest = { ...paid, id: "vi-newest", createdAt: "2026-07-15T00:00:00.000Z" };
    const rows = [vietnamese, rich, paid, newest,
      ...(["en", "pt", "es"] as const).map(language => recorded({ id: language }, language)),
      run({ id: "historical" }), run({ id: "historical-newest", createdAt: "2026-07-16T00:00:00.000Z" })];
    const before = JSON.stringify(rows);
    const entries = buildArchive(rows);
    expect(entries.slice(0, 2).map(entry => [entry.id, entry.answerLanguage])).toEqual([
      ["historical-newest", "und"], ["vi-newest", "vi"],
    ]);
    expect(entries.slice(2).map(entry => entry.answerLanguage).sort()).toEqual(["en", "es", "pt"]);
    async function* scan() { yield* rows; }
    expect(await buildArchiveStream(scan())).toEqual(entries);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("does not infer language from the question or unrecorded intent", () => {
    const value = recorded({ id: "actual-en", question: "Câu hỏi tiếng Việt?" }, "en");
    const intent = { ...run({ id: "intent", question: value.question }), trace: [{ phase: "done" as const, ts: 0,
      message: "Synthetic requested language", detail: { requestedLanguage: "vi", language: "vi" } }] };
    expect(buildArchive([value, intent]).map(entry => entry.answerLanguage).sort()).toEqual(["en", "und"]);
  });

  it.each(["missing", "duplicate", "conflicting", "final-byte-mismatch", "future", "extra-field", "malformed"])(
    "keeps %s recorded provenance undetermined", kind => {
      const value = recorded({ id: kind }, "vi");
      const detail = value.trace[0].detail as { answerLanguage: Record<string, unknown> | null };
      const packet = detail.answerLanguage!;
      if (kind === "missing") value.trace = [];
      if (kind === "duplicate") value.trace = [...value.trace, ...value.trace];
      if (kind === "conflicting") value.trace.push({ ...value.trace[0], detail: { answerLanguage: { ...packet, language: "en" } } });
      if (kind === "final-byte-mismatch") value.answer += " ";
      if (kind === "future") packet.format = "keryx-answer-language-v2";
      if (kind === "extra-field") packet.requestedLanguage = "vi";
      if (kind === "malformed") detail.answerLanguage = null;
      const before = JSON.stringify(value);
      expect(buildArchive([value])[0].answerLanguage).toBe("und");
      expect(JSON.stringify(value)).toBe(before);
    });

  it("drops runs with no answer or no citations", () => {
    const runs = [
      run({ id: "ok" }),
      run({ id: "no-answer", question: "Q2", answer: "  " }),
      run({ id: "no-cite", question: "Q3", citations: [] }),
    ];
    const out = buildArchive(runs);
    expect(out.map((e) => e.id)).toEqual(["ok"]);
  });

  it("dedupes by normalized question, keeping the most-cited then most-paid run", () => {
    const runs = [
      run({ id: "thin", question: "What is x402?", createdAt: "2026-07-12T00:00:00.000Z" }),
      run({
        id: "rich",
        question: "what is x402",
        createdAt: "2026-07-11T00:00:00.000Z",
        citations: [
          { marker: "S1", sourceId: "s1", sourceName: "A", weight: 0.5, reward: 0.001, rationale: "" },
          { marker: "S2", sourceId: "s2", sourceName: "B", weight: 0.5, reward: 0.001, rationale: "" },
        ],
      }),
    ];
    const out = buildArchive(runs);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("rich"); // 2 citations beats 1, even though "thin" is newer
    expect(out[0].citationCount).toBe(2);
  });

  it("sorts distinct questions newest first and truncates long answers", () => {
    const long = "word ".repeat(100);
    const runs = [
      run({ id: "old", question: "Older?", createdAt: "2026-07-01T00:00:00.000Z" }),
      run({ id: "new", question: "Newer?", createdAt: "2026-07-13T00:00:00.000Z", answer: long }),
    ];
    const out = buildArchive(runs);
    expect(out.map((e) => e.id)).toEqual(["new", "old"]);
    expect(out[0].answerSnippet.endsWith("…")).toBe(true);
    expect(out[0].answerSnippet.length).toBeLessThan(long.length);
  });

  it("skips a current opening caveat and keeps the later sentence with its short caution", () => {
    const reason = "Each summary sentence is tied to a verbatim excerpt and model-checked; completeness and independent factual correctness remain unverified. Evidence assessment: 4 sub-claims remain below the evidence threshold.";
    const body = "Export the question, the cited excerpts, the payment state and the date.";
    const raw = confidenceBanner(body, { level: "Low", reason }, "en");
    const before = raw;
    const snippet = archiveAnswerSnippet(raw);
    expect(raw).toBe(before);
    expect(raw).toContain("Each summary sentence is tied");
    expect(snippet).toBe(`⚠ Low confidence — ${body}`);
    expect(snippet).not.toContain("Each summary sentence");
    expect(snippet).not.toContain("Treat this as provisional.");
    const entry = buildArchive([run({
      id: "caveat", question: "How should we export evidence?", answer: raw,
      confidence: { level: "Low", reason },
    })])[0];
    expect(entry.answerSnippet).toBe(snippet);
    expect(entry.confidence).toEqual({ level: "Low", reason });
    const longBody = `Export the question. ${"detail ".repeat(80)}`;
    const longSnippet = archiveAnswerSnippet(confidenceBanner(longBody, { level: "Low", reason }, "en"));
    expect(longSnippet.startsWith("⚠ Low confidence — Export the question.")).toBe(true);
    expect(longSnippet.endsWith("…")).toBe(true);
    expect(longSnippet).not.toContain("Each summary sentence");
    expect(searchTerm(entry)).toBe("how should we export evidence? latent space");
    expect(searchTerm(entry)).not.toContain("cited excerpts");
    const xml = buildAnswersFeedXml([entry], "https://keryx.cc");
    expect(xml).toContain(`⚠ Low confidence — ${body}`);
    expect(xml).not.toContain("Each summary sentence");
    const listed = archiveIndexJsonLd({
      base: "https://keryx.cc", url: "https://keryx.cc/answers", name: "Archive",
      slice: paginateArchive([entry], 1), totalEntries: 1,
    });
    const item = (listed.mainEntity as { itemListElement: Array<Record<string, unknown>> }).itemListElement[0];
    expect(item).toEqual({ "@type": "ListItem", position: 1, url: "https://keryx.cc/dispatch/caveat", name: entry.question });
    expect(JSON.stringify(item)).not.toContain(body);
    const html = renderToStaticMarkup(createElement(ArchiveAnswerRow, { entry }));
    expect(html).toContain(`<p lang="und" class="mt-2 font-serif text-[15px] leading-[1.5] text-ink-2">⚠ Low confidence — ${body}</p>`);
    expect(html).toContain(`title="${reason}"`);
    expect(html).toContain(">Low<");
    expect(html).toContain("confidence");
    expect(metadataAnswerExcerpt(raw)).toBe(snippet);
    expect(metadataAnswerExcerpt("line1\nline2")).toBe("line1 line2");
    expect(metadataAnswerExcerpt("a".repeat(180))).toBe("a".repeat(160));
  });

  it.each([
    ["vi", "Độ tin cậy thấp", "Giữ nguyên câu trả lời đã lưu."],
    ["pt", "Baixa confiança", "Mantenha a frase original salva."],
    ["es", "Confianza baja", "Conserve la frase original guardada."],
  ] as const)("keeps the %s caution label and the original later sentence", (language, label, body) => {
    const raw = confidenceBanner(body, { level: "Low", reason: "Motivo registrado." }, language);
    expect(archiveAnswerSnippet(raw)).toBe(`⚠ ${label} — ${body}`);
    expect(raw).toContain(body);
  });

  it("does not strip a caveat that has no later sentence or no recognized closer", () => {
    const only = confidenceBanner("", { level: "Low", reason: "Evidence assessment: none." }, "en");
    expect(archiveAnswerSnippet(only)).toContain("Treat this as provisional.");
    expect(archiveAnswerSnippet(only)).not.toBe("⚠ Low confidence —");
    const unrecognized = "⚠ Low confidence — a reason without the provisional sentence. Useful body.";
    expect(extractiveAnswerPreview(unrecognized)).toBeNull();
    expect(archiveAnswerSnippet(unrecognized)).toBe(unrecognized);
  });
});

describe("relatedAnswers", () => {
  function entry(over: Partial<ArchiveEntry>): ArchiveEntry {
    return {
      id: "e1",
      question: "What is x402?",
      answerSnippet: "",
      citationCount: 1,
      toCreators: 0.001,
      totalSpent: 0.01,
      sourceNames: ["Latent Space"],
      createdAt: "2026-07-10T00:00:00.000Z",
      confidence: null,
      ...over,
    };
  }
  const current = { id: "cur", question: "How does x402 settle payments?", sourceNames: ["Latent Space"] };

  it("ranks shared cited sources above keyword overlap", () => {
    const archive = [
      entry({ id: "kw", question: "Where do payments flow on Arc?", sourceNames: ["Other Blog"] }),
      entry({ id: "src", question: "Who runs the Gateway contract?", sourceNames: ["Latent Space"] }),
    ];
    const out = relatedAnswers(current, archive, 2);
    expect(out[0].id).toBe("src"); // 1 shared source (×2) beats keyword hits
  });

  it("excludes the current dispatch and any entry for the same question", () => {
    const archive = [
      entry({ id: "cur" }),
      entry({ id: "same-q", question: "how does x402 settle payments" }),
      entry({ id: "other", question: "What is the x402 batching SDK?" }),
    ];
    const out = relatedAnswers(current, archive, 4);
    expect(out.map((e) => e.id)).toEqual(["other"]);
  });

  it("fills with newest entries when nothing overlaps, so no page dead-ends", () => {
    const archive = [
      entry({ id: "a", question: "Elephants in Kenya?", sourceNames: ["Safari"], createdAt: "2026-07-12T00:00:00.000Z" }),
      entry({ id: "b", question: "Bread baking basics?", sourceNames: ["Oven"], createdAt: "2026-07-11T00:00:00.000Z" }),
      entry({ id: "c", question: "Cloud formations?", sourceNames: ["Sky"], createdAt: "2026-07-10T00:00:00.000Z" }),
    ];
    const out = relatedAnswers(current, archive, 2);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]); // newest-first fill
  });

  it("puts scored matches ahead of the fill and respects the limit", () => {
    const archive = [
      entry({ id: "new-noise", question: "Bread baking basics?", sourceNames: ["Oven"], createdAt: "2026-07-13T00:00:00.000Z" }),
      entry({ id: "match", question: "Why did x402 choose HTTP 402?", sourceNames: ["Latent Space"], createdAt: "2026-07-01T00:00:00.000Z" }),
    ];
    const out = relatedAnswers(current, archive, 2);
    expect(out.map((e) => e.id)).toEqual(["match", "new-noise"]);
    expect(relatedAnswers(current, archive, 1).map((e) => e.id)).toEqual(["match"]);
  });
});
