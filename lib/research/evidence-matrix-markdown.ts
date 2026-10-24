import { englishMessages } from "../i18n/messages";
import { buildEvidenceMatrix, type EvidenceMatrixInput } from "./evidence-matrix";
import { evidenceReadScope, evidenceReadScopeColumns } from "./evidence-matrix-read-scope";

/** Keep recorded text literal, even when it contains Markdown fences or HTML. */
function exactBlock(value: string): string[] {
  let length = 3;
  for (const match of value.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = "`".repeat(length);
  return [fence, value, fence];
}

function recordedField(label: string, value: string): string[] {
  return [label, "", ...exactBlock(value), ""];
}

/** Same inspectable rows as the CSV, with each recorded excerpt kept verbatim. */
export function evidenceMatrixMarkdown(run: EvidenceMatrixInput): string {
  const lines = ["# Research evidence matrix", "",
    "These are the same inspectable rows as the evidence CSV. A target with no excerpt here has no inspectable excerpt recorded; this file does not decide whether the target is true.", "",
    "Read scope describes recorded extraction, not source correctness or complete coverage. An unclipped extraction does not prove that the whole document, images or OCR were read. Missing historical scope remains unknown.", ""];
  for (const row of buildEvidenceMatrix(run)) {
    lines.push(`## Target ${row.claimIndex + 1}`, "", ...recordedField("Research target (unverified):", row.claim), `Inspection status: ${row.status}`);
    for (const [index, item] of row.evidence.entries()) {
      const provenance = item.evidenceProvenance === "synthetic-demo"
        ? englishMessages["evidenceMatrix.syntheticExport"]
        : englishMessages["evidenceMatrix.unclassifiedExport"];
      const scope = evidenceReadScope(item);
      lines.push("", `### Evidence ${index + 1}`, "",
        ...recordedField("Source marker:", item.marker),
        ...recordedField("Source id:", item.sourceId),
        ...recordedField("Publication:", item.sourceName),
        ...recordedField("Article title:", item.itemTitle ?? englishMessages["evidenceMatrix.notRecorded"]),
        ...recordedField("Article URL:", item.itemUrl ?? englishMessages["evidenceMatrix.notRecorded"]),
        ...recordedField("Published:", item.itemPublishedAt ?? englishMessages["evidenceMatrix.notRecorded"]),
        ...recordedField("Item id:", item.itemId ?? englishMessages["evidenceMatrix.notRecorded"]),
        ...recordedField("Content version:", item.contentVersion ?? englishMessages["evidenceMatrix.notRecorded"]),
        `Evidence provenance: ${provenance}`,
        "", ...recordedField("Exact excerpt:", item.quote),
        ...evidenceReadScopeColumns.flatMap(([key, label]) => recordedField(`${label}:`, scope[key] || englishMessages["evidenceMatrix.notRecorded"])));
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
