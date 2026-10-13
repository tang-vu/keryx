import type { DraftExcerpt, EvidenceDraftRequest } from "./evidence-draft";

/** Dispositions are explicit caller observations about exact saved records. A
 * missing excerpt alone says nothing about whether an original was attempted. */
export function relatedWorkReadingLists(input: EvidenceDraftRequest, excerpts: readonly DraftExcerpt[]) {
  const included = input.workspace.entries.filter(row => row.screening === "include");
  const dispositions = input.readingStatuses ?? [];
  if (new Set(dispositions.map(row => row.paperUrl)).size !== dispositions.length) throw new Error("Duplicate reading dispositions");
  for (const row of dispositions) {
    if (!included.some(entry => entry.paper.url === row.paperUrl)) throw new Error("Reading disposition requires an exact Include record");
    if (excerpts.some(excerpt => excerpt.paperUrl === row.paperUrl)) throw new Error("Reading disposition conflicts with retained evidence");
  }
  const missing = included.filter(row => !excerpts.some(excerpt => excerpt.paperUrl === row.paper.url));
  const classify = (status: "unread" | "unavailable" | undefined) => missing.flatMap(row => {
    const observation = dispositions.find(observation => observation.paperUrl === row.paper.url);
    return observation?.status === status ? [{ paper: row.paper, ...(observation ? { observation } : {}) }] : [];
  });
  return { origin: "caller-observation" as const, unread: classify("unread"), unavailable: classify("unavailable"), unknown: classify(undefined) };
}
