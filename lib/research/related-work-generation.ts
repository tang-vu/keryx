import type { DraftExcerpt, EvidenceDraftRequest } from "./evidence-draft";
import { referenceKey } from "./reference-export-core";
import { MAX_ASK_QUESTION_CHARS } from "../ask-input";
import type { LiteratureWorkspace } from "../papers/literature-workspace";

export type RelatedWorkAssembly = { mode: "append" } | { mode: "regenerate"; themeId: string };

const themeTitle = (target: string) => {
  let title = "";
  for (const scalar of target.trim() || "Retained contributions") {
    if (title.length + scalar.length > 120) break;
    title += scalar;
  }
  return title;
};

/** Deliberate handoff to the existing budgeted reader, never automatic dispatch.
 * Omit notes and screening data, and retain the exact saved URL. */
export function relatedWorkReadingDraft(workspace: LiteratureWorkspace, paperUrl: string): string {
  if (!workspace.entries.some(row => row.screening === "include" && row.paper.url === paperUrl)) throw new Error("Reading draft requires an exact Include record");
  const question = `Read this exact paper for a related-work review${workspace.question.trim() ? ` on: ${workspace.question.trim()}` : ""}.\n${paperUrl}\nRetain verbatim excerpts from this exact version for its contributions, methods and stated limitations. Cite the original content. State unreadable or abstract-only limits; do not infer findings from metadata. Keep the normal budget, BUY/SKIP/CACHE reasons and creator-reward rules.`;
  if (question.length > MAX_ASK_QUESTION_CHARS) throw new Error("Reading draft exceeds the existing question limit");
  return question;
}

/** Literal extractive drafting only. Topic labels come from the original research
 * targets, never metadata. Similar wording is not evidence of agreement or a gap. */
export function assembleRelatedWorkThemes(input: EvidenceDraftRequest, retained: readonly { excerpt: DraftExcerpt; target: string }[], operation: RelatedWorkAssembly) {
  const excerpts = retained.map(row => row.excerpt);
  const used = new Set(input.themes.flatMap(theme => [theme.id, ...(theme.statements ?? []).map(row => row.id)]));
  const fresh = (seed: string) => {
    const base = referenceKey(seed, "relatedWork");
    let key = base, suffix = 1;
    while (used.has(key)) key = `${base}_${suffix++}`;
    used.add(key); return key;
  };
  const statement = (row: DraftExcerpt, themeId: string) => ({
    id: fresh(`${themeId}:${row.id}`), kind: "contribution" as const,
    text: `The retained excerpt states: “${row.quote}”`, paperUrls: [row.paperUrl], excerptIds: [row.id],
  });
  if (operation.mode === "regenerate") {
    const theme = input.themes.find(row => row.id === operation.themeId);
    if (!theme) throw new Error("Unknown theme");
    const selected = theme.excerptIds.map(id => {
      const row = excerpts.find(row => row.id === id);
      if (!row) throw new Error("Selected excerpt is unavailable or changed");
      return row;
    });
    if (!selected.length || selected.length > 24) throw new Error("Select one to 24 retained excerpts to regenerate a theme");
    return input.themes.map(row => row.id === theme.id ? { ...row, statements: selected.map(excerpt => statement(excerpt, row.id)) } : row);
  }
  // Already organised evidence is left alone, including author edits and withheld
  // statements. Append only evidence for exact records not yet organised.
  const organised = new Set(input.themes.flatMap(theme => [
    ...theme.excerptIds.map(id => excerpts.find(row => row.id === id)?.paperUrl),
    ...(theme.statements ?? []).flatMap(row => row.paperUrls),
  ]));
  const records = new Map<string, { excerpt: DraftExcerpt; target: string }>();
  for (const row of retained) if (!organised.has(row.excerpt.paperUrl) && !records.has(row.excerpt.paperUrl)) records.set(row.excerpt.paperUrl, row);
  const groups = new Map<string, DraftExcerpt[]>();
  for (const { excerpt: row, target } of records.values()) {
    // Split large groups without omitting records or silently exceeding the contract.
    let index = 1, group = target;
    while ((groups.get(group)?.length ?? 0) >= 24) group = `${target} (${++index})`;
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  if (input.themes.length + groups.size > 16) throw new Error("Too many retained themes; organise excerpts in existing themes first");
  return [...input.themes, ...[...groups].map(([target, rows]) => {
    const themeId = fresh(JSON.stringify(rows.map(row => row.id)));
    return { id: themeId, title: themeTitle(target), authorNote: "", excerptIds: rows.map(row => row.id),
      statements: rows.map(row => statement(row, themeId)) };
  })];
}
