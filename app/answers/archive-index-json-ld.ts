/**
 * CollectionPage + ItemList for one page of the answer archive.
 *
 * The list describes the answers on *this* page, with positions carrying their rank in the whole
 * archive — so page 3 starts at 121 rather than restarting at 1, and a crawler reading all the
 * pages assembles one ordered corpus instead of several competing lists of the same shape.
 */

import type { ArchivePage } from "@/lib/answers-pagination";
import { ANSWERS_PAGE_SIZE } from "@/lib/answers-pagination";

export function archiveIndexJsonLd({
  base,
  url,
  name,
  description,
  slice,
  totalEntries,
  partOf,
}: {
  base: string;
  url: string;
  name: string;
  description?: string;
  slice: ArchivePage;
  totalEntries: number;
  /** Set on pages 2+ and on topic hubs, to point back at the archive they slice. */
  partOf?: { name: string; url: string };
}): Record<string, unknown> {
  const offset = (slice.page - 1) * ANSWERS_PAGE_SIZE;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    url,
    ...(description ? { description } : {}),
    ...(partOf ? { isPartOf: { "@type": "CollectionPage", ...partOf } } : {}),
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: totalEntries,
      itemListElement: slice.items.map((e, i) => ({
        "@type": "ListItem",
        position: offset + i + 1,
        url: `${base}/dispatch/${e.id}`,
        name: e.question,
      })),
    },
  };
}
