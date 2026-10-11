export interface DraftCitationExports { markdown: string; latex: string; bibtex: string; ris: string }
export interface DraftCitationReference { key: string; url: string }

export const DRAFT_REFERENCES_HEADING = "## References";
const sameMembers = (observed: readonly string[], expected: readonly string[]) =>
  observed.length === expected.length && [...observed].sort().join("\n") === [...expected].sort().join("\n");
const matches = (content: string, pattern: RegExp) => [...content.matchAll(pattern)].map(match => match[1]);

// Only the URL field syntax emitted by paperReferencesBibtex, not arbitrary TeX.
const bibtexUrlField = /^  url = \{((?:[^\\{}%&_#$^~\r\n]|\\(?:textbackslash\{\}|textasciicircum\{\}|textasciitilde\{\}|[{}%&_#$]))*)\},?$/gm;
const decodedBibtexUrl = (value: string) => value.replace(/\\(textbackslash\{\}|textasciicircum\{\}|textasciitilde\{\}|[{}%&_#$])/g,
  (_, escaped: string) => ({ "textbackslash{}": "\\", "textasciicircum{}": "^", "textasciitilde{}": "~" })[escaped] ?? escaped);

/** Re-read the four finished exports and refuse any citation/reference drift.
 *
 * Every key cited in the Markdown and LaTeX bodies must have exactly one BibTeX
 * entry, one Markdown reference line and one RIS record for the same exact URL,
 * and no reference may exist without a citation. The check parses the produced
 * bytes instead of trusting the structures they were rendered from. RIS has no
 * citation-key field, so its records are matched by exact record URL. */
export function assertDraftCitationParity(exports: DraftCitationExports, references: readonly DraftCitationReference[]): void {
  const keys = references.map(row => row.key), unique = (values: readonly string[]) => [...new Set(values)];
  const fail = () => { throw new Error("Citation and reference list do not correspond"); };
  if (references.length > 50 || unique(keys).length !== keys.length || unique(references.map(row => row.url)).length !== references.length
    || references.some(row => !/^keryxDraft[a-f0-9]+$/.test(row.key) || !row.url || /[<>\s]/u.test(row.url))) fail();
  const expectedUrls = new Map(references.map(row => [row.key, row.url]));
  const split = exports.markdown.lastIndexOf(`\n${DRAFT_REFERENCES_HEADING}\n`);
  if (split < 0) fail();
  const cited = (content: string, group: RegExp, separator: string) => unique(matches(content, group)
    .flatMap(list => list.split(separator)));
  const markdownCited = cited(exports.markdown.slice(0, split), /\[(@[^\]\r\n]+)\]/g, "; ")
    .map(key => key.slice(1));
  const markdownListed = exports.markdown.slice(split + `\n${DRAFT_REFERENCES_HEADING}\n`.length)
    .split("\n").filter(line => line.trim()).map(line => {
      const row = /^- \[@(keryxDraft[a-f0-9]+)\] .* — <([^<>\r\n]+)>$/.exec(line);
      if (!row || expectedUrls.get(row[1]) !== row[2]) fail();
      return row![1];
    });
  const latexCited = cited(exports.latex, /\\autocite\{([^}]*)\}/g, ",");
  // A formatter record has a header, single-line fields and a standalone closing
  // brace. Inspect URL fields inside each record so a set-wise URL swap cannot pass.
  const bibtexRecord = /^@(?:article|inproceedings|misc)\{([a-zA-Z0-9]+),\n((?:  (?:title|url|author|year|doi|eprint|archivePrefix|journal|booktitle|note) = \{[^\r\n]*\},?\n)+)\}$/gm;
  const bibtexKeys = [...exports.bibtex.matchAll(bibtexRecord)].map(record => {
    const urls = matches(record[2], bibtexUrlField);
    if (urls.length !== 1 || matches(record[2], /^(  url) = /gm).length !== 1
      || decodedBibtexUrl(urls[0]) !== expectedUrls.get(record[1])) fail();
    return record[1];
  });
  if (exports.bibtex.replace(bibtexRecord, "").trim()) fail();
  const risRecord = /^TY {2}- [^\r\n]+\r?\n[\s\S]*?^ER {2}- (?:\r?\n|$)/gm;
  const risUrls = [...exports.ris.matchAll(risRecord)].map(record => {
    const urls = matches(record[0], /^UR {2}- ([^\r\n]*)\r?$/gm);
    if (urls.length !== 1 || matches(record[0], /^(TY) {2}- /gm).length !== 1) fail();
    return urls[0];
  });
  if (exports.ris.replace(risRecord, "").trim()) fail();
  if (!sameMembers(markdownCited, keys) || !sameMembers(markdownListed, keys) || !sameMembers(latexCited, keys)
    || !sameMembers(bibtexKeys, keys) || !sameMembers(risUrls, references.map(row => row.url))) fail();
}
