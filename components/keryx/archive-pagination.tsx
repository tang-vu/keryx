/**
 * Page-to-page navigation for the answer archive.
 *
 * Plain server-rendered anchors on purpose: this is the path a crawler walks to reach the older
 * half of the corpus, so it has to exist in the HTML with real hrefs — no click handler, no
 * infinite scroll. Numbers are windowed around the current page, with the first and last always
 * reachable, so the markup stays flat however long the archive gets.
 */

import { createMessages } from "@/lib/i18n/messages";
import Link from "next/link";
import { archiveLanguagePath } from "@/lib/answers-language";
import { UiElement, UiMessage } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");

const WINDOW = 2;

/** Page numbers to show: first, last, and a window around the current page. */
function pageNumbers(page: number, totalPages: number): number[] {
  const wanted = new Set<number>([1, totalPages]);
  for (let p = page - WINDOW; p <= page + WINDOW; p++) {
    if (p >= 1 && p <= totalPages) wanted.add(p);
  }
  return [...wanted].sort((a, b) => a - b);
}

const linkClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center border border-line bg-paper px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink transition-colors hover:border-seal hover:text-seal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal";

export function ArchivePagination({ page, totalPages, language = null }: { page: number; totalPages: number; language?: string | null }) {
  if (totalPages <= 1) return null;
  const numbers = pageNumbers(page, totalPages);

  return (
    <UiElement as="nav" names={["aria-label"]} attributes={{ "aria-label": copy("archivePages.label"), "className": "mt-10 flex flex-wrap items-center gap-2 border-t border-line pt-6" }}>
      {page > 1 && (
        <Link href={archiveLanguagePath(page - 1, language)} rel="prev" className={linkClass}>
          <UiMessage messageKey={"archivePages.newer"} />
        </Link>
      )}

      {numbers.map((n, i) => {
        // A gap in the sequence means pages were skipped by the window.
        const gap = i > 0 && n - numbers[i - 1]! > 1;
        return (
          <span key={n} className="flex items-center gap-2">
            {gap && <span className="font-mono text-[11px] text-ink-3">…</span>}
            {n === page ? (
              <span
                aria-current="page"
                className="inline-flex min-h-11 min-w-11 items-center justify-center border border-ink bg-ink px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-paper"
              >
                {n}
              </span>
            ) : (
              <Link href={archiveLanguagePath(n, language)} className={linkClass}>
                {n}
              </Link>
            )}
          </span>
        );
      })}

      {page < totalPages && (
        <Link href={archiveLanguagePath(page + 1, language)} rel="next" className={linkClass}>
          <UiMessage messageKey={"archivePages.older"} />
        </Link>
      )}
    </UiElement>
  );
}
