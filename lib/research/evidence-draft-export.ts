import { buildEvidenceDraft, type EvidenceDraft } from "./evidence-draft";
import { paperReferencesBibtex, paperReferencesRis } from "../papers/reference-export";

const latex = (text: string) => text.replace(/[\\{}%&_#$^~]/g, char => ({
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", "&": "\\&", "_": "\\_",
  "#": "\\#", "$": "\\$", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
})[char]!);
const markdown = (text: string) => text.replace(/[\\`*_{}\[\]<>#!|]/g, "\\$&");
const single = (text: string) => text.replace(/[\r\n\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ");

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
  for (const theme of draft.themes) {
    md.push(`## ${markdown(single(theme.title))}`, ""); tex.push(`\\subsection{${latex(single(theme.title))}}`, "");
    if (theme.authorNote) {
      md.push("Author notes (unverified; review before use):", "", ...theme.authorNote.split(/\r?\n/).map(line => markdown(line)), "");
      tex.push("\\paragraph{Author notes (unverified; review before use)}", latex(theme.authorNote), "");
    }
    for (const excerpt of theme.excerpts) {
      md.push(`<a id="${excerpt.id}"></a>`, ...excerpt.quote.split(/\r\n|\r|\n/).map(line => `> ${markdown(line)}`), "",
        `[@${key(excerpt.paperUrl)}] — [exact record](<${excerpt.paperUrl}>) · version ${markdown(single(excerpt.contentVersion))} · report ${markdown(excerpt.reportId)}`, "");
      tex.push(`\\label{${excerpt.id}}`, "\\begin{quote}", latex(excerpt.quote), "\\end{quote}",
        `\\autocite{${key(excerpt.paperUrl)}}. Version: ${latex(excerpt.contentVersion)}. Report: ${latex(excerpt.reportId)}.`, "");
    }
  }
  md.push("## Included papers without usable retained excerpts", "");
  tex.push("\\subsection{Included papers without usable retained excerpts}", "");
  for (const row of draft.unread) {
    md.push(`- ${markdown(single(row.paper.title))}: retained excerpt unavailable; not described.`);
    tex.push(`${latex(single(row.paper.title))}: retained excerpt unavailable; not described.\\par`);
  }
  md.push("", "## References", "", ...draft.references.map(row => `- [@${row.key}] ${markdown(single(row.paper.title))} — <${row.paper.url}>`), "");
  tex.push("", "\\printbibliography", "");
  return { markdown: md.join("\n"), latex: tex.join("\n"), ...references, referenceCount: draft.references.length };
}
