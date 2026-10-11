import type { DraftExcerpt } from "./evidence-draft";

/** Sentence roles of a related-work section. A gap may cite no paper; every other
 * role names papers and therefore needs retained excerpts from each of them. */
export const RELATED_WORK_STATEMENT_KINDS = ["contribution", "agreement", "disagreement", "gap"] as const;
export type RelatedWorkStatementKind = typeof RELATED_WORK_STATEMENT_KINDS[number];
export interface RelatedWorkStatementInput {
  id: string; kind: RelatedWorkStatementKind; text: string; paperUrls: string[]; excerptIds: string[];
}
export type RelatedWorkStatementStatus = "excerpt-bound" | "author-gap" | "withheld";
export type RelatedWorkWithheldReason = "paper-count" | "paper-without-selected-excerpt";
export interface RelatedWorkStatement extends RelatedWorkStatementInput {
  excerpts: DraftExcerpt[];
  status: RelatedWorkStatementStatus;
  withheldReason?: RelatedWorkWithheldReason;
  /** Cited exact records with no selected retained excerpt in this statement. */
  missingPaperUrls?: string[];
}

const unique = (values: readonly string[]) => new Set(values).size === values.length;

/** A contribution describes one paper; agreement and disagreement compare at least two. */
export function relatedWorkPaperCountFits(kind: RelatedWorkStatementKind, count: number): boolean {
  return kind === "contribution" ? count === 1 : kind === "gap" ? true : count >= 2;
}

/** Statement identifiers become export anchors, so they are unique across the whole draft. */
export function assertRelatedWorkStatementShape(statements: readonly RelatedWorkStatementInput[]): void {
  if (!unique(statements.map(row => row.id))) throw new Error("Duplicate draft identifiers");
  for (const row of statements)
    if (!unique(row.paperUrls) || !unique(row.excerptIds)) throw new Error("Duplicate statement selections");
}

/** Bind each sentence to the exact retained excerpts it relies on.
 *
 * The binding is structural: a statement is exportable only when every paper it
 * cites has a selected retained excerpt from that exact record and version. It
 * does not establish that the excerpt supports the author's wording. An incomplete
 * statement is withheld rather than exported without evidence; an unknown, changed
 * or foreign excerpt is refused by the caller-supplied `selected` resolver. */
export function resolveRelatedWorkStatements(statements: readonly RelatedWorkStatementInput[],
  selected: (ids: readonly string[]) => DraftExcerpt[]): RelatedWorkStatement[] {
  return statements.map(statement => {
    const excerpts = selected(statement.excerptIds);
    if (excerpts.some(row => !statement.paperUrls.includes(row.paperUrl))) throw new Error("Statement excerpt cites a different exact work");
    const missingPaperUrls = statement.paperUrls.filter(paperUrl => !excerpts.some(row => row.paperUrl === paperUrl));
    const withheldReason: RelatedWorkWithheldReason | undefined = !relatedWorkPaperCountFits(statement.kind, statement.paperUrls.length)
      ? "paper-count" : missingPaperUrls.length ? "paper-without-selected-excerpt" : undefined;
    return { ...statement, excerpts,
      status: withheldReason ? "withheld" : statement.paperUrls.length ? "excerpt-bound" : "author-gap",
      ...(withheldReason ? { withheldReason, missingPaperUrls } : {}) };
  });
}
