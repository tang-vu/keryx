import type { PreviewDepth } from "@/lib/sources/preview-depth";
import { createMessages } from "./messages";

const copy = createMessages("en");

/** Presentation projection; preview levels and source truncation remain source-owned. */
export const previewDepthLabels: Record<PreviewDepth, { label: string; hint: string }> = {
  full: { label: copy("creatorPreview.fullLabel"), hint: copy("creatorPreview.fullHint") },
  excerpt: { label: copy("creatorPreview.excerptLabel"), hint: copy("creatorPreview.excerptHint") },
  locked: { label: copy("creatorPreview.lockedLabel"), hint: copy("creatorPreview.lockedHint") },
};
