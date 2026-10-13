import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResolvedDispatch } from "../history/read-dispatch";
import type { QueryRun, Citation } from "../types";
import { AnswerMarkdown } from "../../components/keryx/answer-markdown";
import { closedDispatchMetadata, publicDispatchMetadata } from "./report-metadata";

const fixture = vi.hoisted(() => ({ resolve: vi.fn<() => Promise<ResolvedDispatch | null>>() }));
vi.mock("@/lib/history/read-dispatch", () => ({ resolveDispatch: fixture.resolve }));
import { generateMetadata } from "../../app/dispatch/[id]/page";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const run = (question: string, answer: string): QueryRun => ({ id: "original_277", question, answer, createdAt: "2026-10-12T00:00:00Z",
  engine: "offline-fixture", budget: 0, totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], citations: [], trace: [], paymentMode: "offline" });
const params = { params: Promise.resolve({ id: "original_277" }) };

describe("actual report metadata language and privacy boundaries", () => {
  it.each(["Tiếng Việt: nghiên cứu", "中文：研究问题", "Answer in Portuguese"])(
    "keeps one original canonical and UNKNOWN output language for %s", async question => {
      const original = run(question, "Literal original answer [S1] — USDC 0.000001");
      fixture.resolve.mockResolvedValue({ run: original, reader: {} as ResolvedDispatch["reader"], archive: null, visibility: "public" });
      vi.stubEnv("LANG", "vi-VN");
      const before = JSON.stringify(original), result = await generateMetadata(params);
      expect(result.alternates).toEqual({ canonical: "/dispatch/original_277", languages: {}, types: {} });
      expect(result.other).toEqual({ "DC.language": "und" });
      expect(result.title).toContain(question);
      expect(result.twitter).toMatchObject({ title: result.title, description: result.openGraph?.description });
      expect(result.openGraph).not.toHaveProperty("locale");
      expect(JSON.stringify(original)).toBe(before);
    });

  it("refuses private/unlisted/unknown metadata before touching a hidden answer and clears root inheritance", async () => {
    const secret = run("SECRET QUESTION", "SECRET ANSWER");
    Object.defineProperty(secret, "answer", { get() { throw Error("Private text must not be read"); } });
    for (const visibility of ["private", "unlisted"] as const) {
      fixture.resolve.mockResolvedValue({ run: secret, reader: {} as ResolvedDispatch["reader"], archive: null, visibility });
      expect(await generateMetadata(params)).toEqual(closedDispatchMetadata());
    }
    fixture.resolve.mockResolvedValue(null); const unknown = await generateMetadata(params);
    fixture.resolve.mockRejectedValue(Error("Fixture storage unavailable")); expect(await generateMetadata(params)).toEqual(unknown);
    expect(unknown).toMatchObject({ description: null, robots: { index: false, follow: false }, referrer: "no-referrer",
      alternates: { canonical: null, languages: {}, types: {} }, openGraph: null, twitter: null, other: {} });
    expect(JSON.stringify(unknown)).not.toMatch(/SECRET|original_277/);
  });

  it("does not advertise a locale variant or accept an unstable report identity", () => {
    const text = "Recorded {question} <evidence> 中文";
    const result = publicDispatchMetadata({ id: "original_277", title: text, description: text, openGraphDescription: text });
    expect(result.title).toBe(text); expect(result.twitter?.description).toBe(text);
    expect(() => publicDispatchMetadata({ id: "../private", title: text, description: text, openGraphDescription: text })).toThrow("identity");
  });
});

describe("recorded answer DOM language without translation", () => {
  const citation: Citation = { marker: "S1", sourceId: "source", sourceName: "Original source 中文", weight: 1, reward: 0.000001, rationale: "Evidence" };
  it.each(["Xin chào: bằng chứng giữ nguyên.", "中文证据，原文不改。", "Literal English evidence."])(
    "marks unrecorded text und while leaving the original answer and citation unchanged: %s", text => {
      const answer = text + " [S1]", before = JSON.stringify(citation);
      const html = renderToStaticMarkup(createElement(AnswerMarkdown, { text: answer, citations: [citation] }));
      expect(html).toMatch(/^<div lang="und"/); expect(html).toContain(text);
      expect(html).toContain('<button lang="en"');
      expect(html).toContain('Original source 中文'); expect(html).toContain("[1]");
      expect(JSON.stringify(citation)).toBe(before); expect(answer).toBe(text + " [S1]");
    });
});
