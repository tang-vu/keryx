/**
 * Page-to-page navigation for the answer archive.
 *
 * Plain server-rendered anchors on purpose: this is the path a crawler walks to reach the older
 * half of the corpus, so it has to exist in the HTML with real hrefs — no click handler, no
 * infinite scroll. Numbers are windowed around the current page, with the first and last always
 * reachable, so the markup stays flat however long the archive gets.
 */

import Link from "next/link";
import { answersPagePath } from "@/lib/answers-pagination";

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
  "border border-ink bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink transition-all hover:-translate-y-0.5 hover:shadow-[0_3px_0_var(--ink)]";

export function ArchivePagination({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const numbers = pageNumbers(page, totalPages);

  return (
    <nav
      aria-label="Archive pages"
      className="mt-10 flex flex-wrap items-center gap-2 border-t border-line pt-6"
    >
      {page > 1 && (
        <Link href={answersPagePath(page - 1)} rel="prev" className={linkClass}>
          ← Newer
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
                className="border border-ink bg-ink px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-paper"
              >
                {n}
              </span>
            ) : (
              <Link href={answersPagePath(n)} className={linkClass}>
                {n}
              </Link>
            )}
          </span>
        );
      })}

      {page < totalPages && (
        <Link href={answersPagePath(page + 1)} rel="next" className={linkClass}>
          Older →
        </Link>
      )}
    </nav>
  );
}
