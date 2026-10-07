import { PAPER_REPOSITORIES, paperRecordSchema, type PaperRecord } from "./types";

// A metadata field cannot introduce a second RIS tag or record.
const field = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/gu, " ").trim();
// Zotero interprets N1 as HTML. Preserve provider text as literal note content.
const noteText = (value: string) => field(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Unread bibliography, never converted into a Citation or inferred read evidence.
 * Validate the complete bounded list before formatting; retain the first snapshot
 * of each exact landing URL and preserve different arXiv versions. */
export function paperReferencesRis(records: readonly PaperRecord[]) {
  const parsed = paperRecordSchema.array().max(50).parse(records);
  const identities = new Map<string, PaperRecord>();
  for (const paper of parsed) {
    // URL parsing can forgive literal control/space bytes. Never rewrite a link
    // and then call it the exact saved identity, or emit those bytes as RIS tags.
    if ([paper.url, paper.metadataUrl].some(url => /[\s\u0000-\u001f\u007f-\u009f]/u.test(url))) throw new Error("Invalid reference link");
    if ([paper.title, ...paper.authors, ...(paper.venue ? [paper.venue] : [])].some(value => !field(value))) throw new Error("Invalid reference metadata");
    if (!identities.has(paper.url)) identities.set(paper.url, paper);
  }
  const papers = [...identities.values()];
  const content = papers.map(paper => {
    const type = paper.publicationKind === "preprint" ? "MANSCPT" : paper.publicationKind === "conference-paper" ? "CONF" : paper.publicationKind === "journal-article" ? "JOUR" : "WEB";
    const note = `Saved bibliography metadata only; no Keryx read, citation or settlement evidence. Publication type: ${paper.publicationKind}. Peer review unknown. Metadata from ${PAPER_REPOSITORIES[paper.repository]}, observed ${paper.metadataObservedAt} (${paper.metadataUrl}).` +
      (paper.venue ? ` Recorded venue: ${paper.venue}.` : "") +
      (paper.arxivId ? ` Exact arXiv version: ${paper.arxivId}.` : "") +
      (paper.authorsTruncated ? ` Incomplete contributor list: ${paper.authors.length}/${paper.authorCount} provider entries have names here.` : "");
    return [`TY  - ${type}`, `TI  - ${field(paper.title)}`, `UR  - ${paper.url}`,
      ...paper.authors.map(author => `AU  - ${field(author)}`),
      ...(paper.publishedYear ? [`PY  - ${paper.publishedYear}`] : []),
      ...(paper.doi ? [`DO  - ${field(paper.doi)}`] : []),
      ...(paper.arxivId ? [`AN  - arXiv:${paper.arxivId}`] : []),
      ...(paper.venue && paper.publicationKind === "journal-article" ? [`JO  - ${field(paper.venue)}`] : []),
      ...(paper.venue && paper.publicationKind === "conference-paper" ? [`T2  - ${field(paper.venue)}`] : []),
      `N1  - ${noteText(note)}`, "ER  - "].join("\r\n");
  }).join("\r\n\r\n");
  return { count: papers.length, content: content ? content + "\r\n" : "" };
}
