import { PAPER_REPOSITORIES, paperRecordSchema, type PaperRecord } from "./types";
import { cslIssued, cslJsonContent, referenceKey, type CslReference } from "../research/reference-export-core";

// A metadata field cannot introduce a second RIS tag or record.
const field = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/gu, " ").trim();
// Zotero interprets N1 as HTML. Preserve provider text as literal note content.
const noteText = (value: string) => field(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Unread bibliography, never converted into a Citation or inferred read evidence.
 * Validate the complete bounded list before formatting; retain the first snapshot
 * of each exact landing URL and preserve different arXiv versions. */
function referencePapers(records: readonly PaperRecord[]) {
  const parsed = paperRecordSchema.array().max(50).parse(records);
  const identities = new Map<string, PaperRecord>();
  for (const paper of parsed) {
    // URL parsing can forgive literal control/space bytes. Never rewrite a link
    // and then call it the exact saved identity, or emit those bytes as RIS tags.
    if ([paper.url, paper.metadataUrl].some(url => /[\s\u0000-\u001f\u007f-\u009f]/u.test(url))) throw new Error("Invalid reference link");
    if ([paper.title, ...paper.authors, ...(paper.venue ? [paper.venue] : [])].some(value => !field(value))) throw new Error("Invalid reference metadata");
    if (!identities.has(paper.url)) identities.set(paper.url, paper);
  }
  return [...identities.values()];
}

function provenanceNote(paper: PaperRecord) {
  return `Saved bibliography metadata only; no Keryx read, citation or settlement evidence. Publication type: ${paper.publicationKind}. Peer review unknown. Withdrawal/replacement status unknown. Metadata from ${PAPER_REPOSITORIES[paper.repository]}, observed ${paper.metadataObservedAt} (${paper.metadataUrl}).` +
    (paper.venue ? ` Recorded venue: ${paper.venue}.` : "") +
    (paper.arxivId ? ` Exact arXiv version: ${paper.arxivId}.` : "") +
    (paper.authorsTruncated ? ` Incomplete contributor list: ${paper.authors.length}/${paper.authorCount} provider entries have names here; missing positions are not established.` : "");
}

/** Saved metadata only. Exact versions keep separate stable keys without claiming a read. */
export function paperReferencesCslJson(records: readonly PaperRecord[]) {
  const papers = referencePapers(records);
  const entries: CslReference[] = papers.map(paper => {
    const key = referenceKey(paper.url, "keryxPaper");
    return {
      id: key, "citation-key": key,
      type: paper.publicationKind === "journal-article" ? "article-journal" : paper.publicationKind === "conference-paper" ? "paper-conference" : paper.publicationKind === "preprint" ? "manuscript" : "webpage",
      title: field(paper.title), URL: paper.url,
      ...(paper.authors.length ? { author: paper.authors.map(author => ({ literal: field(author) })) } : {}),
      ...(paper.publishedYear ? { issued: cslIssued(String(paper.publishedYear)) } : {}),
      ...(paper.doi ? { DOI: field(paper.doi) } : {}),
      ...(paper.venue && ["journal-article", "conference-paper"].includes(paper.publicationKind) ? { "container-title": field(paper.venue) } : {}),
      ...(paper.arxivId ? { archive: "arXiv", archive_location: paper.arxivId } : {}),
      note: provenanceNote(paper),
    };
  });
  return { count: entries.length, content: cslJsonContent(entries) };
}

export function paperReferencesRis(records: readonly PaperRecord[]) {
  const papers = referencePapers(records);
  const content = papers.map(paper => {
    const type = paper.publicationKind === "preprint" ? "MANSCPT" : paper.publicationKind === "conference-paper" ? "CONF" : paper.publicationKind === "journal-article" ? "JOUR" : "WEB";
    const note = provenanceNote(paper);
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

/** Literal provider names, without guessed given/family splits or publication status. */
export function paperReferencesBibtex(records: readonly PaperRecord[]) {
  const papers = referencePapers(records);
  const escape = (value: string) => field(value).replace(/[\\{}%&_#$^~]/g, char => ({
    "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", "&": "\\&", "_": "\\_",
    "#": "\\#", "$": "\\$", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
  })[char]!);
  const keys = papers.map(paper => referenceKey(paper.url, "keryxPaper"));
  if (new Set(keys).size !== keys.length) throw new Error("Reference identifier collision");
  const content = papers.map((paper, index) => {
    const fields: Array<[string, string]> = [["title", `{${escape(paper.title)}}`], ["url", escape(paper.url)]];
    if (paper.authors.length) fields.push(["author", paper.authors.map(author => `{${escape(author)}}`).join(" and ")]);
    if (paper.publishedYear) fields.push(["year", String(paper.publishedYear)]);
    if (paper.doi) fields.push(["doi", escape(paper.doi)]);
    if (paper.arxivId) fields.push(["eprint", escape(paper.arxivId)], ["archivePrefix", "arXiv"]);
    if (paper.venue && paper.publicationKind === "journal-article") fields.push(["journal", escape(paper.venue)]);
    if (paper.venue && paper.publicationKind === "conference-paper") fields.push(["booktitle", escape(paper.venue)]);
    fields.push(["note", escape(provenanceNote(paper))]);
    const kind = paper.publicationKind === "journal-article" ? "article" : paper.publicationKind === "conference-paper" ? "inproceedings" : "misc";
    return `@${kind}{${keys[index]},\n${fields.map(([key, value]) => `  ${key} = {${value}}`).join(",\n")}\n}`;
  }).join("\n\n");
  return { count: papers.length, content: content ? content + "\n" : "" };
}
