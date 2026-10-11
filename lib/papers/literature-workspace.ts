import { z } from "zod";
import { MAX_ASK_QUESTION_CHARS } from "../ask-input";
import { evidenceCsvCell } from "../research/evidence-matrix";
import { paperRecordSchema, type PaperRecord } from "./types";
import { createMessages, englishMessages } from "../i18n/messages";

const copy = createMessages("en");

export const LITERATURE_STORAGE_KEY = "keryx-literature-workspace-v1";
export const MAX_LITERATURE_BYTES = 1_048_576;
export const MAX_SAVED_PAPERS = 50;
// Keys and fixed English values are also part of the existing screening CSV.
export const SCREENING_STATES = {
  unscreened: englishMessages["paperWorkspace.screening.unscreened"],
  include: englishMessages["paperWorkspace.screening.include"],
  exclude: englishMessages["paperWorkspace.screening.exclude"],
  undecided: englishMessages["paperWorkspace.screening.undecided"],
} as const;

export const literatureWorkspaceSchema = z.object({
  version: z.literal(1), scope: z.literal("personal-bibliography"),
  title: z.string().max(120), question: z.string().max(600),
  entries: z.array(z.object({
    paper: paperRecordSchema, savedAt: z.string().datetime(),
    screening: z.enum(["unscreened", "include", "exclude", "undecided"]), notes: z.string().max(2000),
  }).strict()).max(MAX_SAVED_PAPERS),
}).strict().refine(value => new Set(value.entries.map(entry => entry.paper.url)).size === value.entries.length,
  copy("paperWorkspace.duplicateRecords"));
export type LiteratureWorkspace = z.infer<typeof literatureWorkspaceSchema>;
export type LiteratureEntry = LiteratureWorkspace["entries"][number];

export function emptyLiteratureWorkspace(): LiteratureWorkspace {
  return { version: 1, scope: "personal-bibliography", title: "", question: "", entries: [] };
}
export function parseLiteratureWorkspace(raw: string): LiteratureWorkspace {
  if (new TextEncoder().encode(raw).byteLength > MAX_LITERATURE_BYTES) throw new Error(copy("paperWorkspace.backupLimit"));
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error(copy("paperWorkspace.unsupportedBackup")); }
  const parsed = literatureWorkspaceSchema.safeParse(value);
  if (!parsed.success) throw new Error(copy("paperWorkspace.unsupportedBackup"));
  return parsed.data;
}
export function serializeLiteratureWorkspace(workspace: LiteratureWorkspace): string {
  const raw = JSON.stringify(workspace);
  parseLiteratureWorkspace(raw);
  return raw;
}

/** Retain the first snapshot of an exact landing URL. Group IDs are mutable and never storage identities. */
export function saveLiteraturePaper(workspace: LiteratureWorkspace, paper: PaperRecord, savedAt: string): LiteratureWorkspace {
  if (workspace.entries.some(entry => entry.paper.url === paper.url)) return workspace;
  if (workspace.entries.length >= MAX_SAVED_PAPERS) throw new Error(copy("paperWorkspace.capacity"));
  return literatureWorkspaceSchema.parse({ ...workspace,
    entries: [...workspace.entries, { paper, savedAt, screening: "unscreened", notes: "" }] });
}

export function literatureScreeningCsv(workspace: LiteratureWorkspace): string {
  const rows: (string | number)[][] = [["project", "research_question", "screening_decision", "personal_notes", "title", "authors", "author_count", "authors_incomplete",
    "year", "venue", "doi", "arxiv_version", "paper_url", "repository", "metadata_url", "metadata_observed_at", "saved_at", "scope"]];
  for (const entry of workspace.entries) {
    const paper = entry.paper;
    rows.push([workspace.title, workspace.question, SCREENING_STATES[entry.screening], entry.notes, paper.title,
      paper.authors.join("; "), paper.authorCount, String(paper.authorsTruncated), paper.publishedYear ?? "", paper.venue ?? "",
      paper.doi ?? "", paper.arxivId ?? "", paper.url, paper.repository, paper.metadataUrl, paper.metadataObservedAt, entry.savedAt,
      "Bibliographic metadata only; screening and notes are user supplied; paper text unread by this workspace; peer review unknown"]);
  }
  return rows.map(row => row.map(evidenceCsvCell).join(",")).join("\r\n") + "\r\n";
}

/** No notes, screening decisions or backup bytes are sent to research implicitly. */
export function literatureComparisonDraft(workspace: LiteratureWorkspace, urls: readonly string[]): string {
  if (urls.length !== 2 || new Set(urls).size !== 2) throw new Error(copy("paperWorkspace.selectTwo"));
  const papers = urls.map(url => workspace.entries.find(entry => entry.paper.url === url)?.paper);
  if (papers.some(paper => !paper)) throw new Error(copy("paperWorkspace.selectionMissing"));
  const draft = `Compare these two papers for a literature review${workspace.question.trim() ? ` on: ${workspace.question.trim()}` : ""}.\n${papers.map(paper => paper!.url).join("\n")}\nCompare their research questions, methods, findings and limitations using citations to original content. State abstract-only or extraction limits and any evidence gaps. Do not infer findings from bibliographic metadata.`;
  if (draft.length > MAX_ASK_QUESTION_CHARS) throw new Error(copy("paperWorkspace.questionLimit"));
  return draft;
}
