import { PAPER_CATALOG } from '../../papers/catalog';
import { emptyLiteratureWorkspace, saveLiteraturePaper } from '../../papers/literature-workspace';
import type { EvidenceDraftRequest } from '../evidence-draft';

export function evidenceDraftFixture(): EvidenceDraftRequest {
  const paper = PAPER_CATALOG[0];
  const workspace = saveLiteraturePaper(emptyLiteratureWorkspace(), paper, "2026-10-09T00:00:00.000Z");
  workspace.title = "Methods review"; workspace.question = "Which method fits this task?"; workspace.entries[0].screening = "include";
  const identity = { sourceId: "original-paper", marker: "S1", itemId: "paper-v1", itemUrl: paper.url,
    itemTitle: paper.title, contentVersion: "sha256:version-one" };
  return { version: 1, scope: "private-evidence-draft", workspace,
    reports: [{ id: "retained1", subClaims: ["Original research target"], citations: [identity], evidence: [{ ...identity,
      claimIndex: 0, claim: "Original research target", quote: "The evaluated method improved the measured outcome.",
      qualifiesForAnswer: true, qualifiesForReward: false }] }],
    passage: "This method improves every possible task.", claims: [{ id: "claim1", start: 0, end: "This method improves every possible task.".length,
      paperUrls: [paper.url], excerptIds: [] }], themes: [{ id: "theme1", title: "Methods", authorNote: "Needs expert review", excerptIds: [] }] };
}
