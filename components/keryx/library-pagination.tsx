import Link from "next/link";
import { UiMessage } from "@/lib/i18n/ui-copy";
import type { LibraryKind } from "@/lib/sources/library-browse";
import { libraryCollectionAnchor, libraryPageNumbers, libraryPaginationHref, type LibraryPaginationContext } from "@/lib/sources/library-pagination";

const linkClass = "inline-flex min-h-11 min-w-11 items-center justify-center border border-line bg-paper px-3 py-2 font-mono text-xs text-seal hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal";

/** Real GET links keep every directory entry reachable without sending hidden cards first. */
export function LibraryPagination({ kind, page, totalPages, context }: {
  kind: LibraryKind; page: number; totalPages: number; context: LibraryPaginationContext;
}) {
  if (totalPages <= 1) return null;
  const numbers = libraryPageNumbers(page, totalPages);
  return <nav aria-labelledby={`${libraryCollectionAnchor(kind)}-title`} className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
    {numbers.map((number, index) => <span key={number} className="inline-flex items-center gap-2">
      {index > 0 && number - numbers[index - 1] > 1 && <span aria-hidden="true" className="text-ink-3">…</span>}
      {number === page
        ? <span aria-current="page" className="inline-flex min-h-11 min-w-11 items-center justify-center border border-ink bg-ink px-3 py-2 font-mono text-xs text-paper">{number}</span>
        : <Link prefetch={false} href={libraryPaginationHref(context, kind, number)} className={linkClass}>{number}</Link>}
    </span>)}
    {page < totalPages && <Link prefetch={false} href={libraryPaginationHref(context, kind, page + 1)} className={linkClass}>
      <UiMessage messageKey="sourceArchive.next" /><span aria-hidden="true" className="ms-2 rtl:rotate-180">→</span>
    </Link>}
  </nav>;
}
