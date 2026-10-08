import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { recognizeBibliographicTask } from "./bibliographic-task-request";
import { readBibliographicTask } from "./bibliographic-task";
import { frenchArxivTask, frenchDoiTask } from "./fixtures/bibliographic-task-questions";

const html = readFileSync(new URL("./fixtures/arxiv-2005.11401v4-bibliography.html", import.meta.url), "utf8");
const observedAt = "2026-10-08T00:00:00.000Z";

describe("separate ordinary original bibliography task", () => {
  it("delivers original French arXiv metadata with exact-version exports and precise status gaps", async () => {
    const task = recognizeBibliographicTask(frenchArxivTask)!;
    const reader = vi.fn(async (url: string) => ({ requestedUrl: url, finalUrl: url, observedAt, mediaType: "text/html" as const, body: html, truncated: false as const }));
    const result = await readBibliographicTask(task, { reader });
    expect(reader).toHaveBeenCalledExactlyOnceWith("https://arxiv.org/abs/2005.11401v4", undefined);
    expect(result).toMatchObject({ kind: "bibliography", scope: "metadata-only", originalQuestionSha256: task.originalQuestionSha256,
      record: { peerReview: "unknown", fields: { title: { state: "observed" }, firstAuthor: { state: "observed", value: "Patrick Lewis" },
        identifier: { state: "observed", value: "2005.11401v4" }, status: { state: "missing", reason: "not-explicit" } } } });
    expect(result.text).toContain("Notice de la page originale uniquement");
    expect(result.bibliographyExports.bibtex.content).toContain("eprint = {2005.11401v4}");
    expect(result.bibliographyExports.ris.content).toContain("AN  - arXiv:2005.11401v4");
    expect(result).not.toHaveProperty("evidence");
    expect(result).not.toHaveProperty("citations");
    expect(result).not.toHaveProperty("payments");
  });

  it("delivers explicit Crossref metadata independently from scientific findings", async () => {
    const task = recognizeBibliographicTask(frenchDoiTask)!;
    const body = JSON.stringify({ status: "ok", "message-type": "work", message: { DOI: task.request.target.kind === "doi" ? task.request.target.doi : "",
      title: ["Observed title"], author: [{ given: "First", family: "Author" }, { given: "Second", family: "Author" }, { given: "Third", family: "Author" }],
      published: { "date-parts": [[2021, 7, 15]] }, "container-title": ["Observed Journal"], type: "journal-article", abstract: "A preview is not research evidence." } });
    const result = await readBibliographicTask(task, { reader: async url => ({ requestedUrl: url, finalUrl: url, observedAt, mediaType: "application/json", body, truncated: false }) });
    expect(result.record.fields.firstAuthor).toMatchObject({ state: "observed", value: "First Author" });
    expect(result.record.authors.map(author => author.position)).toEqual([1, 2, 3]);
    expect(result.text).not.toContain("A preview is not research evidence.");
    expect(result.record.peerReview).toBe("unknown");
    expect(result.bibliographyExports.ris.count).toBe(1);
  });

  it("retains precise gaps on unavailable transport without a model, fallback, retry or export invention", async () => {
    const task = recognizeBibliographicTask(frenchArxivTask)!;
    const reader = vi.fn(async () => { throw new Error("Unavailable"); });
    const result = await readBibliographicTask(task, { reader });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(result.record.failure).toBe("read-unavailable");
    expect(result.bibliographyExports.bibtex.count).toBe(0);
    expect(result.bibliographyExports.ris.count).toBe(0);
    expect(result.text).toContain("lecture des métadonnées originales indisponible");
  });

  it("rejects restored tasks before reading and propagates cancellation", async () => {
    const task = recognizeBibliographicTask(frenchArxivTask)!;
    const reader = vi.fn(async () => { throw new Error("Must not read"); });
    await expect(readBibliographicTask(JSON.parse(JSON.stringify(task)), { reader })).rejects.toThrow("Unobserved bibliographic task");
    const controller = new AbortController(); controller.abort();
    await expect(readBibliographicTask(task, { reader, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(reader).not.toHaveBeenCalled();
  });
});
