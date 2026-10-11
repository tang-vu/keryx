export interface DraftCitationExports { markdown: string; latex: string; bibtex: string; ris: string }
export interface DraftCitationReference { key: string; url: string }

export const DRAFT_REFERENCES_HEADING = "## References";
const sameMembers = (observed: readonly string[], expected: readonly string[]) =>
  observed.length === expected.length && [...observed].sort().join("\n") === [...expected].sort().join("\n");
const matches = (content: string, pattern: RegExp) => [...content.matchAll(pattern)].map(match => match[1]);

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
  if (unique(keys).length !== keys.length) fail();
  const split = exports.markdown.lastIndexOf(`\n${DRAFT_REFERENCES_HEADING}\n`);
  if (split < 0) fail();
  const cited = (content: string, group: RegExp, separator: string) => unique(matches(content, group)
    .flatMap(list => list.split(separator)));
  const markdownCited = cited(exports.markdown.slice(0, split), /\[((?:@keryxDraft[a-f0-9]+)(?:; @keryxDraft[a-f0-9]+)*)\]/g, "; ")
    .map(key => key.slice(1));
  const markdownListed = matches(exports.markdown.slice(split), /^- \[@(keryxDraft[a-f0-9]+)\] /gm);
  const latexCited = cited(exports.latex, /\autocite\{([^}]*)\}/g, ",");
  const bibtexKeys = matches(exports.bibtex, /^@(?:article|inproceedings|misc)\{([a-zA-Z0-9]+),$/gm);
  const risUrls = matches(exports.ris, /^UR {2}- (.*)$/gm), risRecords = matches(exports.ris, /^(TY) {2}- /gm);
  if (!sameMembers(markdownCited, keys) || !sameMembers(markdownListed, keys) || !sameMembers(latexCited, keys)
    || !sameMembers(bibtexKeys, keys) || !sameMembers(risUrls, references.map(row => row.url))
    || risRecords.length !== references.length) fail();
}
