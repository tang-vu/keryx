import { buildEvidenceDraft, type EvidenceDraft } from "./evidence-draft";
import { paperReferencesBibtex, paperReferencesRis } from "../papers/reference-export";
import { assertDraftCitationParity, DRAFT_REFERENCES_HEADING } from "./evidence-draft-parity";
import { referenceKey } from "./reference-export-core";
import type { RelatedWorkStatementKind } from "./related-work-statements";
import { pdfReadingNotice } from "./pdf-reading";

const latex = (text: string) => text.replace(/[\\{}%&_#$^~]/g, char => ({
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", "&": "\\&", "_": "\\_",
  "#": "\\#", "$": "\\$", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
})[char]!);
// Escaping @ keeps author and provider text from ever forming a Pandoc citation key.
const markdown = (text: string) => text.replace(/[\\`*_{}\[\]<>#!|@]/g, "\\$&");
export const RELATED_WORK_STATEMENT_LABELS: Record<RelatedWorkStatementKind, string> = {
  contribution: "Contribution", agreement: "Agreement", disagreement: "Disagreement", gap: "Gap" };
const STATEMENT_NOTICE = "Draft statements, editable by the author. Extractive assembly quotes retained text; other wording is author-written. Each cites its paper and links the retained excerpt it relies on; whether an excerpt supports the wording is not verified.";
const AUTHOR_GAP_LABEL = "Gap (author-stated; cites no paper; unverified)";
const withheldNotice = (count: number) => `Withheld: ${count} author statement${count === 1 ? " is" : "s are"} not exported, because a cited paper has no selected retained excerpt or the statement kind needs a different number of papers.`;
/** Statement identifiers are author chosen; anchors and LaTeX labels use a stable alphanumeric key. */
export const statementAnchor = (id: string) => referenceKey(id, "statement");
const single =(text: string) => text.replace(/[\r\n\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ");

function referenceExports(draft: EvidenceDraft) {
  const records = draft.references.map(row => row.paper);
  // Each validated singleton keeps its exact chosen draft key independently of the
  // upstream exporter's old ordered or future stable-key scheme.
  const bibtex = draft.references.map(row => rekeyDraftBibtex(paperReferencesBibtex([row.paper]).content, row.key)).join("\n");
  return { bibtex, ris: paperReferencesRis(records).content };
}

/** Replace only the initial header of one validated formatter record; never text fields. */
export function rekeyDraftBibtex(content: string, key: string): string {
  if (!/^keryxDraft[a-f0-9]+$/.test(key) || !/^@(?:article|inproceedings|misc)\{[a-zA-Z0-9]+,\n/.test(content))
    throw new Error("Unsupported singleton bibliography header");
  return content.replace(/^(@(?:article|inproceedings|misc)\{)[a-zA-Z0-9]+,\n/, (_, prefix: string) => `${prefix}${key},\n`);
}

/** Export is rebuilt from a validated request, never from mutable UI result assertions. */
export function exportEvidenceDraft(value: unknown) {
  const draft = buildEvidenceDraft(value), references = referenceExports(draft);
  const key = (url: string) => draft.references.find(row => row.paper.url === url)!.key;
  const md = [`# ${markdown(single(draft.title || "Related-work evidence draft"))}`, "", markdown(draft.notice), "",
    `Review question: ${markdown(draft.question)}`, ""];
  const tex = ["% Use with biblatex: \\addbibresource{references.bib}", "\\section{Related-work evidence draft}", latex(draft.notice), "",
    `Review question: ${latex(draft.question)}`, ""];
  const anchored = new Set<string>();
  for (const theme of draft.themes) {
    md.push(`## ${markdown(single(theme.title))}`, ""); tex.push(`\\subsection{${latex(single(theme.title))}}`, "");
    if (theme.authorNote) {
      md.push("Author notes (unverified; review before use):", "", ...theme.authorNote.split(/\r?\n/).map(line => markdown(line)), "");
      tex.push("\\paragraph{Author notes (unverified; review before use)}", latex(theme.authorNote), "");
    }
    const stated = theme.statements.filter(row => row.status !== "withheld"), withheld = theme.statements.length - stated.length;
    if (stated.length) { md.push(`_${markdown(STATEMENT_NOTICE)}_`, ""); tex.push(`\\emph{${latex(STATEMENT_NOTICE)}}`, ""); }
    for (const statement of stated) {
      const anchor = statementAnchor(statement.id), body = single(statement.text).trim();
      if (statement.status === "author-gap") {
        md.push(`<a id="${anchor}"></a>`, `**${markdown(AUTHOR_GAP_LABEL)}.** ${markdown(body)}`, "");
        tex.push(`\\paragraph{${latex(AUTHOR_GAP_LABEL)}}\\label{${anchor}} ${latex(body)}`, "");
        continue;
      }
      const label = RELATED_WORK_STATEMENT_LABELS[statement.kind], keys = statement.paperUrls.map(key);
      md.push(`<a id="${anchor}"></a>`, `**${label}.** ${markdown(body)} [${keys.map(value => `@${value}`).join("; ")}] — retained excerpts: ${
        statement.excerpts.map((row, index) => `[${index + 1}](#${row.id})`).join(", ")}`, "");
      tex.push(`\\paragraph{${label}}\\label{${anchor}} ${latex(body)} \\autocite{${keys.join(",")}} (retained excerpts: ${
        statement.excerpts.map(row => `p.~\\pageref{${row.id}}`).join(", ")})`, "");
    }
    if (withheld) { md.push(`_${markdown(withheldNotice(withheld))}_`, ""); tex.push(`\\emph{${latex(withheldNotice(withheld))}}`, ""); }
    // Every excerpt a statement links is quoted in the same theme, so each link resolves.
    const quoted = [...new Map([...theme.excerpts, ...stated.flatMap(row => row.excerpts)].map(row => [row.id, row])).values()];
    for (const excerpt of quoted) {
      // One anchor per excerpt: a quotation repeated in a later theme keeps the first target.
      const first = !anchored.has(excerpt.id); anchored.add(excerpt.id);
      md.push(...(first ? [`<a id="${excerpt.id}"></a>`] : []), ...excerpt.quote.split(/\r\n|\r|\n/).map(line => `> ${markdown(line)}`), "",
        `[@${key(excerpt.paperUrl)}] — [exact record](<${excerpt.paperUrl}>) · version ${markdown(single(excerpt.contentVersion))} · report ${markdown(excerpt.reportId)}${
          excerpt.readUrl ? ` · [retained read](<${excerpt.readUrl}>)` : ""}`, "");
      tex.push(...(first ? [`\\label{${excerpt.id}}`] : []), "\\begin{quote}", latex(excerpt.quote), "\\end{quote}",
        `\\autocite{${key(excerpt.paperUrl)}}. Version: ${latex(excerpt.contentVersion)}. Report: ${latex(excerpt.reportId)}.${
          excerpt.readUrl ? ` Retained read URL: ${latex(excerpt.readUrl)}.` : ""}`, "");
      const scope = pdfReadingNotice(excerpt.pdfTextScope);
      if (scope) { md.push(markdown(scope), ""); tex.push(latex(scope), ""); }
      if (excerpt.htmlSectionScope) {
        const notice = `Only HTML heading section #${excerpt.htmlSectionScope.fragment} was read; the surrounding document was not read.`;
        md.push(markdown(notice), ""); tex.push(latex(notice), "");
      }
    }
  }
  md.push("## Included papers without usable retained excerpts", "");
  tex.push("\\subsection{Included papers without usable retained excerpts}", "");
  for (const row of draft.reading.unknown) {
    md.push(`- ${markdown(single(row.paper.title))}: retained excerpt unavailable; not described.`);
    tex.push(`${latex(single(row.paper.title))}: retained excerpt unavailable; not described.\\par`);
  }
  for (const [heading, rows, status] of [
    ["Unread papers (caller observation)", draft.reading.unread, "not read"],
    ["Unavailable papers (caller observation)", draft.reading.unavailable, "unavailable"],
  ] as const) {
    md.push("", `## ${heading}`, ""); tex.push("", `\\subsection{${heading}}`, "");
    for (const row of rows) {
      const reason = row.observation?.reason.trim();
      const line = `${single(row.paper.title)}: ${status}; not described.${reason ? ` Reason: ${single(reason)}` : ""}`;
      md.push(`- ${markdown(line)}`); tex.push(`${latex(line)}\\par`);
    }
  }
  md.push("", DRAFT_REFERENCES_HEADING, "", ...draft.references.map(row => `- [@${row.key}] ${markdown(single(row.paper.title))} — <${row.paper.url}>`), "");
  tex.push("", "\\printbibliography", "");
  const exports = { markdown: md.join("\n"), latex: tex.join("\n"), ...references };
  // Refuse the export rather than hand over a citation without its reference, or the reverse.
  assertDraftCitationParity(exports, draft.references.map(row => ({ key: row.key, url: row.paper.url })));
  return { ...exports, referenceCount: draft.references.length };
}
