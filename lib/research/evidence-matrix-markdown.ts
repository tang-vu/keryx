import { englishMessages } from "../i18n/messages";
import { buildEvidenceMatrix, type EvidenceMatrixInput } from "./evidence-matrix";

/** Indent a recorded value so Markdown keeps its characters as text. */
function exactBlock(value: string): string[] {
  return value.split("\n").map(line => `    ${line}`);
}

/** Same inspectable rows as the CSV, with each recorded excerpt kept verbatim. */
export function evidenceMatrixMarkdown(run: EvidenceMatrixInput): string {
  const lines = ["# Research evidence matrix", "",
    "These are the same inspectable rows as the evidence CSV. A target with no excerpt here has no inspectable excerpt recorded; this file does not decide whether the target is true.", ""];
  for (const row of buildEvidenceMatrix(run)) {
    lines.push(`## Target ${row.claimIndex + 1}`, "", "Research target (unverified):", ...exactBlock(row.claim), "", `Inspection status: ${row.status}`);
    for (const item of row.evidence) {
      const provenance = item.evidenceProvenance === "synthetic-demo"
        ? englishMessages["evidenceMatrix.syntheticExport"]
        : englishMessages["evidenceMatrix.unclassifiedExport"];
      lines.push("", `### ${item.marker}`, "",
        `Source id: ${item.sourceId}`,
        `Publication: ${item.sourceName}`,
        `Article title: ${item.itemTitle ?? englishMessages["evidenceMatrix.notRecorded"]}`,
        `Article URL: ${item.itemUrl ?? englishMessages["evidenceMatrix.notRecorded"]}`,
        `Published: ${item.itemPublishedAt ?? englishMessages["evidenceMatrix.notRecorded"]}`,
        `Item id: ${item.itemId ?? englishMessages["evidenceMatrix.notRecorded"]}`,
        `Content version: ${item.contentVersion ?? englishMessages["evidenceMatrix.notRecorded"]}`,
        `Evidence provenance: ${provenance}`,
        "", "Exact excerpt:", ...exactBlock(item.quote));
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
