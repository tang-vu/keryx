import { PAPER_CATALOG } from "../lib/papers/catalog";
import { emptyLiteratureWorkspace, saveLiteraturePaper } from "../lib/papers/literature-workspace";

export function literatureBackupFixture() {
  const paper = { ...PAPER_CATALOG[0], title: "Literal metadata 🧪", authors: ["José Đặng"], authorCount: 1, authorsTruncated: false };
  const arxivId = paper.arxivId!.replace(/v\d+$/, "v99");
  const version = { ...paper, arxivId, url: `https://arxiv.org/abs/${arxivId}`, metadataUrl: `https://export.arxiv.org/api/query?id_list=${arxivId}` };
  let workspace = saveLiteraturePaper(emptyLiteratureWorkspace(), paper, "2026-10-20T00:00:00Z");
  workspace = saveLiteraturePaper(workspace, version, "2026-10-21T00:00:00Z");
  workspace.title = "PRIVATE_REVIEW_TITLE"; workspace.question = "PRIVATE_REVIEW_QUESTION";
  workspace.entries[0].screening = "include"; workspace.entries[1].screening = "exclude";
  workspace.entries[0].notes = "PRIVATE_SCREENING_NOTES"; workspace.entries[1].notes = "PRIVATE_OTHER_NOTES";
  return workspace;
}
