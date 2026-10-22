import type { LiteratureWorkspace } from "../papers/literature-workspace";
import { SCREENING_STATES } from "../papers/literature-workspace";
import { researchGuidesCopy } from "../../locales/en/research-guides";
import { emptyMatrixRow, validateLiteratureMatrix } from "./literature-matrix";
import type { MatrixDocument } from "./literature-matrix-file";

/** A reading worksheet derived from a validated backup, never evidence of reading. */
export function literatureLibraryMatrix(workspace: LiteratureWorkspace): MatrixDocument {
  const copy = researchGuidesCopy.tool;
  const rows = workspace.entries.map(({ paper, screening, notes }) => {
    const authors = paper.authors.join("; ");
    const incomplete = paper.authorsTruncated ? copy.libraryIncompleteAuthors
      .replace("{recorded}", String(paper.authors.length)).replace("{total}", String(paper.authorCount)) : "";
    return {
      ...emptyMatrixRow(),
      title: [paper.title, authors, incomplete, paper.publishedYear?.toString()].filter(value => value !== undefined && value !== "").join("\n"),
      // Keep the versioned landing URL even when a DOI is also recorded.
      identifier: [paper.url, paper.doi].filter(Boolean).join("\n"),
      decision: [SCREENING_STATES[screening], notes].filter(value => value !== "").join("\n"),
    };
  });
  // Refuse the whole conversion instead of clipping author names or personal notes.
  validateLiteratureMatrix(workspace.question, rows);
  return { question: workspace.question, rows };
}
