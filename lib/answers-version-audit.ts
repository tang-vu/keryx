/** Metadata-only comparison between immutable citation receipts and current indexed assets. */

import type { KeryxDB } from "./db/keryx-db";
import { sourceItemContentVersion } from "./sources/source-item-asset";
import type { Citation } from "./types";

export type CitedVersionStatus = "current" | "superseded" | "unavailable";

export interface CitedVersionCheck {
  marker: string;
  sourceId: string;
  sourceName: string;
  itemId: string;
  itemTitle?: string;
  citedVersion: string;
  currentVersion?: string;
  status: CitedVersionStatus;
}

/**
 * Compare each exact article receipt with the current indexed asset. This never decrypts, previews
 * or buys the body. A changed hash/CID says the article version moved; it says nothing about
 * whether the replacement improves or invalidates the archived answer.
 */
export async function checkCitedVersions(
  db: Pick<KeryxDB, "getItem">,
  citations: Citation[],
): Promise<CitedVersionCheck[]> {
  const exact = citations.filter(
    (citation): citation is Citation & { itemId: string; contentVersion: string } =>
      Boolean(citation.sourceId && citation.itemId && citation.contentVersion),
  );

  return Promise.all(
    exact.map(async (citation) => {
      const base = {
        marker: citation.marker,
        sourceId: citation.sourceId,
        sourceName: citation.sourceName,
        itemId: citation.itemId,
        ...(citation.itemTitle ? { itemTitle: citation.itemTitle } : {}),
        citedVersion: citation.contentVersion,
      };
      try {
        const current = await db.getItem(citation.sourceId, citation.itemId);
        if (!current) return { ...base, status: "unavailable" as const };
        const currentVersion = sourceItemContentVersion(current);
        return {
          ...base,
          currentVersion,
          status:
            currentVersion === citation.contentVersion
              ? ("current" as const)
              : ("superseded" as const),
        };
      } catch {
        return { ...base, status: "unavailable" as const };
      }
    }),
  );
}
