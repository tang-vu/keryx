import { createMessages } from "@/lib/i18n/messages";

import type { Metadata } from "next";
import { Suspense } from "react";
import { EmbedClient } from "./embed-client";

const message = createMessages("en");

/**
 * /embed — the compact ask surface that public/widget.js iframes into third-party
 * sites. Anonymous treasury path only (no wallet inside a partitioned iframe).
 * noindex: this is a widget surface, not a page — keryx.cc/ is the canonical ask.
 */
export const metadata: Metadata = {
  title: message("embedResearch.pageTitle"),
  robots: { index: false, follow: false },
};

export default function EmbedPage() {
  // useSearchParams (in the client) requires a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <EmbedClient />
    </Suspense>
  );
}
