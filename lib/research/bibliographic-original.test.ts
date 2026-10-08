import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readBibliographicOriginal, bibliographicOriginalUrl } from "./bibliographic-original";
import { bibliographicOriginalDeliverable } from "./bibliographic-original-text";
import type { BibliographicOriginalRead, BibliographicOriginalRequest } from "./bibliographic-original-types";

// Original-shaped, bounded fixture with owner-retained title/ordered names. Its
// HTML/abstract/history are synthetic; no fresh provider observation is claimed.
const html = readFileSync(new URL("./fixtures/arxiv-2005.11401v4-bibliography.html", import.meta.url), "utf8");
const title = "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks";
const time = "2026-10-06T00:00:00.000Z";
const arxiv: BibliographicOriginalRequest = { scope: "metadata-only", language: "fr", target: { kind: "arxiv", id: "2005.11401v4" } };
const doi = "10.1038/s41586-021-03819-2";
const crossref: BibliographicOriginalRequest = { scope: "metadata-only", language: "fr", target: { kind: "doi", doi } };
const work = { DOI: doi, title: ["Highly accurate protein structure prediction with AlphaFold"], type: "journal-article",
  author: [{ given: "John", family: "Jumper" }, { given: "Richard", family: "Evans" }, { given: "Alexander", family: "Pritzel" }],
  published: { "date-parts": [[2021, 7, 15]] }, "container-title": ["Nature"], abstract: "Synthetic scientific preview" };
const json = (value: unknown = work) => JSON.stringify({ status: "ok", "message-type": "work", message: value });
function read(request: BibliographicOriginalRequest, body = html, changes: Partial<BibliographicOriginalRead> = {}): BibliographicOriginalRead {
  return { requestedUrl: bibliographicOriginalUrl(request), finalUrl: bibliographicOriginalUrl(request), observedAt: time,
    mediaType: request.target.kind === "arxiv" ? "text/html" : "application/json", body, truncated: false, ...changes };
}

describe("explicit original bibliography primitive", () => {
  it("supports the frozen French exact-version request with field-level raw provenance and honest status gaps", async () => {
    const reader = vi.fn(async () => read(arxiv));
    const record = await readBibliographicOriginal(arxiv, reader);
    expect(reader).toHaveBeenCalledExactlyOnceWith("https://arxiv.org/abs/2005.11401v4", undefined);
    expect(record.failure).toBeUndefined(); expect(record.peerReview).toBe("unknown");
    expect(record.fields.title).toMatchObject({ state: "observed", value: title });
    expect(record.fields.firstAuthor).toMatchObject({ state: "observed", value: "Patrick Lewis" });
    expect(record.fields.identifier).toMatchObject({ state: "observed", value: "2005.11401v4" });
    for (const name of ["year", "journal", "doi", "status"] as const) expect(record.fields[name]).toEqual({ state: "missing", reason: "not-explicit" });
    expect(record.source).toMatchObject({ url: read(arxiv).finalUrl, observedAt: time, bodySha256: createHash("sha256").update(html).digest("hex") });
    for (const field of Object.values(record.fields)) for (const source of field.provenance ?? []) {
      expect(source.start).toBeGreaterThanOrEqual(0); expect(source.end).toBeGreaterThan(source.start!);
      expect(source.rawExcerpt).toBe(html.slice(source.start, source.end));
    }
    expect(record.authors.slice(0, 3).map(author => [author.position, author.name])).toEqual([[1, "Patrick Lewis"], [2, "Ethan Perez"], [3, "Aleksandra Piktus"]]);
    expect(record).toMatchObject({ authorCount: 12, authorsIncomplete: false, paper: { arxivId: "2005.11401v4", publicationKind: "unknown", peerReview: "unknown" } });
    const result = bibliographicOriginalDeliverable(record);
    for (const value of [title, "Premier auteur à la position originale 1: Patrick Lewis", "Identifiant exact observé: 2005.11401v4",
      "Statut explicitement affiché (énoncé littéral): non explicitement enregistré", "DOI: non explicitement enregistré", "Provenance des champs",
      "Référence bibliographique courte", "eprint = {2005.11401v4}", "AN  - arXiv:2005.11401v4", "texte intégral"])
      expect(result.text).toContain(value);
    expect(result.bibliographyExports.bibtex.count).toBe(1); expect(result.bibliographyExports.ris.count).toBe(1);
    expect(result.text).not.toMatch(/Synthetic scientific|withdrawn baselines|replaced baselines|DO  - |year = \{/u);
    for (const authority of ["citations", "researchExports", "gatheredContent", "paymentAttempts", "payTo", "evidenceScope", "weight", "ledger"])
      { expect(record).not.toHaveProperty(authority); expect(result).not.toHaveProperty(authority); }
  });

  it("retains a literal dedicated status with original provenance without inferring peer review from it", async () => {
    const body = html.replace("</main>", '<div class="withdrawal">This paper has been withdrawn by the authors.</div></main>');
    const record = await readBibliographicOriginal(arxiv, async () => read(arxiv, body));
    expect(record.fields.status).toMatchObject({ state: "observed", value: "This paper has been withdrawn by the authors.",
      provenance: [{ path: "[class~=withdrawal]", rawExcerpt: '<div class="withdrawal">This paper has been withdrawn by the authors.</div>' }] });
    expect(record.peerReview).toBe("unknown");
    expect(bibliographicOriginalDeliverable(record).text).toContain("Statut explicitement affiché (énoncé littéral): This paper has been withdrawn by the authors.");
    const explicit = html.replace("</head>", '<meta name="citation_publication_status" content="Submitted; not peer reviewed"></head>');
    expect((await readBibliographicOriginal(arxiv, async () => read(arxiv, explicit))).fields.status).toMatchObject({ state: "observed", value: "Submitted; not peer reviewed" });
  });

  it("excludes inert/hidden status and identity bait, and preserves decoded literal title text", async () => {
    const bait = '<!-- <div class="withdrawal">Forged comment status</div> --><script><div class="withdrawal">Forged script status</div></script>' +
      '<template><span class="arxivid">arXiv:2005.11401v5</span></template><div hidden class="withdrawal">Hidden status</div>' +
      '<blockquote class="abstract"><span class="arxivid">arXiv:2005.11401v5</span><div class="withdrawal">Unrelated abstract withdrawal</div></blockquote>' +
      '<div class="comments"><span class="withdrawal">Unrelated comment status</span></div>' +
      '<div aria-hidden=" TRUE " class="withdrawal">ARIA hidden status</div><div style="display:none" class="withdrawal">CSS hidden status</div>';
    const body = html.replace("</main>", `${bait}</main>`).replaceAll(title, "Bounds &lt;context&gt; &amp; terms");
    const record = await readBibliographicOriginal(arxiv, async () => read(arxiv, body));
    expect(record.failure).toBeUndefined(); expect(record.fields.status).toEqual({ state: "missing", reason: "not-explicit" });
    expect(record.fields.title).toMatchObject({ state: "observed", value: "Bounds <context> & terms" });
  });

  it("uses only explicit valid date/DOI/journal fields and withholds conflicting status assertions", async () => {
    const body = html.replace("</head>", '<meta name="citation_date" content="2020/05/22"><meta name="citation_doi" content="10.1234/observed">' +
      '<meta name="citation_journal_title" content="Synthetic journal"><meta name="citation_publication_status" content="Submitted"></head>')
      .replace("</main>", '<div class="withdrawal">This paper has been withdrawn.</div></main>');
    const record = await readBibliographicOriginal(arxiv, async () => read(arxiv, body));
    expect(record.fields).toMatchObject({ year: { state: "observed", value: "2020" }, doi: { state: "observed", value: "10.1234/observed" },
      journal: { state: "observed", value: "Synthetic journal" }, status: { state: "conflict", reason: "inconsistent" } });
    const invalid = await readBibliographicOriginal(arxiv, async () => read(arxiv, body.replace("2020/05/22", "2020/02/30").replace("10.1234/observed", "not a DOI")));
    expect(invalid.fields.year.state).toBe("missing"); expect(invalid.fields.doi.state).toBe("missing");
    expect(bibliographicOriginalDeliverable(invalid).bibliographyExports.ris.content).not.toMatch(/^PY  - |^DO  - /mu);
  });

  it("keeps original author positions and exports only the intact prefix after a missing slot", async () => {
    const body = html.replace('name="citation_author" content="Ethan Perez"', 'name="citation_author" content=""');
    const record = await readBibliographicOriginal(arxiv, async () => read(arxiv, body));
    expect(record.fields.firstAuthor).toMatchObject({ state: "observed", value: "Patrick Lewis" });
    expect(record.authors.slice(0, 2).map(author => [author.position, author.name])).toEqual([[1, "Patrick Lewis"], [3, "Aleksandra Piktus"]]);
    expect(record).toMatchObject({ authorCount: 12, authorsIncomplete: true, paper: { authors: ["Patrick Lewis"], authorsTruncated: true } });
    const result = bibliographicOriginalDeliverable(record);
    expect(result.text).toContain("1. Patrick Lewis; 2. nom non conservé à cette position; 3. Aleksandra Piktus");
    expect(result.bibliographyExports.ris.content.match(/^AU  - /gmu)).toHaveLength(1);
    const firstMissing = await readBibliographicOriginal(arxiv, async () => read(arxiv, html.replace('name="citation_author" content="Patrick Lewis"', 'name="citation_author" content=""')));
    expect(firstMissing.fields.firstAuthor.state).toBe("missing"); expect(firstMissing.authors[0].position).toBe(2); expect(firstMissing.paper?.authors).toEqual([]);
    expect(bibliographicOriginalDeliverable(firstMissing).bibliographyExports.bibtex.content).not.toContain("author = {");
  });

  it.each(["hidden", 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"'])
  ("preserves a gap at a %s first head contributor instead of shifting later original names", async attribute => {
    const body = html.replace('<meta name="citation_author" content="Patrick Lewis">', `<meta ${attribute} name="citation_author" content="Patrick Lewis">`);
    const record = await readBibliographicOriginal(arxiv, async () => read(arxiv, body));
    expect(record.failure).toBeUndefined(); expect(record.fields.firstAuthor).toMatchObject({ state: "missing", reason: "not-visible" });
    expect(record.authors[0]).toMatchObject({ position: 2, name: "Ethan Perez" });
    expect(record).toMatchObject({ authorCount: 12, authorsIncomplete: true, paper: { authors: [], authorsTruncated: true } });
    const result = bibliographicOriginalDeliverable(record);
    expect(result.text).toContain("1. nom non conservé à cette position; 2. Ethan Perez; 3. Aleksandra Piktus");
    expect(result.text).not.toContain("Premier auteur à la position originale 1: Ethan Perez");
    expect(result.bibliographyExports.ris.content).not.toContain("AU  - ");
    expect(result.bibliographyExports.bibtex.content).not.toContain("author = {");
  });

  it.each(["hidden", 'style="visibility:hidden"'])
  ("retains unavailable contributor slots under a %s head ancestor", async attribute => {
    const record = await readBibliographicOriginal(arxiv, async () => read(arxiv, html.replace("<head>", `<head ${attribute}>`)));
    expect(record.failure).toBeUndefined(); expect(record.fields.firstAuthor).toMatchObject({ state: "missing", reason: "not-visible" });
    expect(record).toMatchObject({ authorCount: 12, authorsIncomplete: true, authors: [], paper: { authors: [], authorsTruncated: true } });
    expect(record.fields.title).toMatchObject({ state: "observed", value: title });
  });

  it("withholds complete over-bound or conflicting fields and refuses a reference with no complete title", async () => {
    const conflict = await readBibliographicOriginal(arxiv, async () => read(arxiv, html.replace(`<span class="descriptor">Title:</span> ${title}`, '<span class="descriptor">Title:</span> Contradictory title')));
    expect(conflict.fields.title).toMatchObject({ state: "conflict", reason: "inconsistent" }); expect(conflict.paper).toBeUndefined();
    expect(bibliographicOriginalDeliverable(conflict)).toMatchObject({ bibliographyExports: { bibtex: { count: 0 }, ris: { count: 0 } } });
    const body = html.replaceAll(title, "T".repeat(1001)).replace('content="Patrick Lewis"', `content="${"A".repeat(301)}"`)
      .replace("</head>", `<meta name="citation_journal_title" content="${"J".repeat(301)}"></head>`);
    const record = await readBibliographicOriginal(arxiv, async () => read(arxiv, body));
    for (const name of ["title", "firstAuthor", "journal"] as const) expect(record.fields[name]).toMatchObject({ state: "missing", reason: "over-bound" });
    expect(record.paper).toBeUndefined(); expect(record.authors[0].position).toBe(2);
  });

  it.each([
    html.replace("arXiv:2005.11401v4", "arXiv:2005.11401v5"), html.replace("arXiv:2005.11401v4", "arXiv:2005.11401"),
    html.replace('<span class="arxivid">arXiv:2005.11401v4</span>', ""), html.replace('content="2005.11401"', 'content="2005.11402"'),
    html.replace("</main>", '<span class="arxivid">arXiv:2005.11401v5</span></main>'),
  ])("rejects an original-shaped page whose independent document version is unverified", async body => {
    const record = await readBibliographicOriginal(arxiv, async () => read(arxiv, body));
    expect(record.failure).toBe("document-identity-changed"); expect(record.source).toBeUndefined(); expect(record.paper).toBeUndefined();
    expect(bibliographicOriginalDeliverable(record).bibliographyExports.ris.count).toBe(0);
  });

  it("does not let request metadata or a changed URL attest another document", async () => {
    for (const changes of [{ finalUrl: "https://arxiv.org/abs/2005.11401v5" }, { finalUrl: "https://arxiv.org/abs/2005.11401" },
      { finalUrl: "https://arxiv.org/abs/2005.11401v4#version" }, { requestedUrl: "https://attacker.invalid/abs/2005.11401v4" }]) {
      const record = await readBibliographicOriginal(arxiv, async () => read(arxiv, html, changes));
      expect(record.failure).toBe("document-identity-changed"); expect(record.source).toBeUndefined(); expect(record.paper).toBeUndefined();
    }
  });

  it("returns the retained French DOI fields from an exact Crossref response, with no abstract/scientific authority", async () => {
    const reader = vi.fn(async () => read(crossref, json()));
    const record = await readBibliographicOriginal(crossref, reader);
    expect(reader).toHaveBeenCalledExactlyOnceWith(`https://api.crossref.org/works/10.1038%2Fs41586-021-03819-2`, undefined);
    expect(record.failure).toBeUndefined();
    expect(record.authors.map(author => [author.position, author.name])).toEqual([[1, "John Jumper"], [2, "Richard Evans"], [3, "Alexander Pritzel"]]);
    expect(record.fields).toMatchObject({ title: { state: "observed", value: work.title[0], provenance: [{ path: "message.title[0]" }] },
      firstAuthor: { state: "observed", value: "John Jumper" }, year: { state: "observed", value: "2021" }, journal: { state: "observed", value: "Nature" },
      doi: { state: "observed", value: doi }, status: { state: "missing", reason: "not-explicit" } });
    const result = bibliographicOriginalDeliverable(record);
    for (const value of ["1. John Jumper; 2. Richard Evans; 3. Alexander Pritzel", "Année: 2021", "Revue enregistrée: Nature", doi, "message.author[0].{given,family}", "DO  - ", "doi = {"])
      expect(result.text).toContain(value);
    expect(result.text).not.toContain("Synthetic scientific preview"); expect(record.peerReview).toBe("unknown");
  });

  it("refuses mismatched DOI identity and invalid envelopes but retains partial fields when only title/names/date are absent", async () => {
    for (const body of [json({ ...work, DOI: "10.1234/other" }), json({ ...work, DOI: undefined })]) {
      const record = await readBibliographicOriginal(crossref, async () => read(crossref, body));
      expect(record.failure).toBe("document-identity-changed"); expect(record.paper).toBeUndefined(); expect(record.source).toBeUndefined();
    }
    for (const body of ["{invalid", JSON.stringify({ message: work }), JSON.stringify({ status: "ok", "message-type": "work-list", message: work })])
      expect((await readBibliographicOriginal(crossref, async () => read(crossref, body))).failure).toBe("invalid-metadata-read");
    const record = await readBibliographicOriginal(crossref, async () => read(crossref, json({ ...work, title: [],
      author: [{}, work.author[1], work.author[2]], published: { "date-parts": [[2021, 2, 30]] } })));
    expect(record.failure).toBeUndefined(); expect(record.fields.identifier.state).toBe("observed");
    for (const name of ["title", "firstAuthor", "year"] as const) expect(record.fields[name].state).toBe("missing");
    expect(record.authors[0]).toMatchObject({ position: 2, name: "Richard Evans" }); expect(record.paper).toBeUndefined();
    expect(bibliographicOriginalDeliverable(record).bibliographyExports.bibtex.count).toBe(0);
    const bounded = await readBibliographicOriginal(crossref, async () => read(crossref, json({ ...work, author: [{ name: "A".repeat(301) }, work.author[1]],
      "container-title": ["J".repeat(301)] })));
    expect(bounded.fields.firstAuthor).toMatchObject({ state: "missing", reason: "over-bound" });
    expect(bounded.fields.journal).toMatchObject({ state: "missing", reason: "over-bound" }); expect(bounded.paper?.authors).toEqual([]);
  });

  it("requires explicit scope and canonical bounded identity before any reader invocation", async () => {
    const reader = vi.fn(async () => read(arxiv));
    for (const input of [{ ...arxiv, scope: undefined }, { ...arxiv, scope: false }, { ...arxiv, scope: "full-paper" },
      { ...arxiv, language: undefined }, { ...arxiv, question: "bibliography please" },
      { ...arxiv, target: { kind: "arxiv", id: "2005.11401" } }, { ...arxiv, target: { kind: "arxiv", id: `2005.11401v${"1".repeat(200)}` } },
      { ...crossref, target: { kind: "doi", doi: "https://doi.org/10.1038/s41586-021-03819-2" } }])
      await expect(readBibliographicOriginal(input, reader)).rejects.toThrow();
    expect(reader).not.toHaveBeenCalled();
  });

  it("reports read failures and bounded/truncated transport as precise gaps, while cancellation propagates", async () => {
    expect((await readBibliographicOriginal(arxiv, async () => { throw new Error("Transport unavailable"); })).failure).toBe("read-unavailable");
    for (const changes of [{ body: "é".repeat(125001) }, { truncated: true }, { mediaType: "application/json" }]) {
      const record = await readBibliographicOriginal(arxiv, async () => ({ ...read(arxiv), ...changes } as BibliographicOriginalRead));
      expect(record.failure).toBe("invalid-metadata-read"); expect(record.fields.title).toEqual({ state: "missing", reason: "read-unavailable" }); expect(record.paper).toBeUndefined();
    }
    const controller = new AbortController(); controller.abort(); const reader = vi.fn(async () => read(arxiv));
    await expect(readBibliographicOriginal(arxiv, reader, controller.signal)).rejects.toMatchObject({ name: "AbortError" }); expect(reader).not.toHaveBeenCalled();
    await expect(readBibliographicOriginal(arxiv, async () => { throw new DOMException("Cancelled", "AbortError"); })).rejects.toMatchObject({ name: "AbortError" });
  });
});
