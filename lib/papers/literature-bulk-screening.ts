import { parseLiteratureWorkspace, SCREENING_STATES, serializeLiteratureWorkspace, type LiteratureEntry, type LiteratureWorkspace } from "./literature-workspace";

export interface LiteratureScreeningPlan { screening: LiteratureEntry["screening"]; entries: LiteratureEntry[] }
export class LiteratureScreeningError extends Error {
  constructor(readonly code: "invalid-selection" | "stale-selection") { super(code); }
}
const checked = (workspace: LiteratureWorkspace) => parseLiteratureWorkspace(serializeLiteratureWorkspace(workspace));

/** A tab-local snapshot of deliberately previewed targets, never evidence. */
export function previewLiteratureScreening(workspace: LiteratureWorkspace, urls: readonly string[], screening: LiteratureEntry["screening"]): LiteratureScreeningPlan {
  const current = checked(workspace);
  if (!Object.hasOwn(SCREENING_STATES, screening) || !urls.length || urls.length > 50 || new Set(urls).size !== urls.length)
    throw new LiteratureScreeningError("invalid-selection");
  const entries = urls.map(url => current.entries.find(entry => entry.paper.url === url));
  if (entries.some(entry => !entry)) throw new LiteratureScreeningError("invalid-selection");
  return { screening, entries: entries as LiteratureEntry[] };
}

/** Caller holds the existing workspace lock. Check every snapshot before any
 * mutation: a changed/missing target refuses the entire decision. */
export function applyLiteratureScreening(workspace: LiteratureWorkspace, plan: LiteratureScreeningPlan): LiteratureWorkspace {
  const current = checked(workspace);
  if (!Object.hasOwn(SCREENING_STATES, plan.screening) || !plan.entries.length) throw new LiteratureScreeningError("invalid-selection");
  const snapshots = checked({ ...current, entries: plan.entries }).entries;
  const targets = new Map(snapshots.map(entry => [entry.paper.url, entry]));
  for (const [url, expected] of targets) {
    const latest = current.entries.find(entry => entry.paper.url === url);
    if (!latest || JSON.stringify(latest) !== JSON.stringify(expected)) throw new LiteratureScreeningError("stale-selection");
  }
  return checked({ ...current, entries: current.entries.map(entry => targets.has(entry.paper.url) ? { ...entry, screening: plan.screening } : entry) });
}
