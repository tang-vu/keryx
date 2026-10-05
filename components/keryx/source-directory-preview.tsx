import Link from "next/link";
import type { SourceDirectory } from "@/lib/sources/source-directory";
import { PublicReferenceCard } from "./public-reference-card";
import { publisherControlLabel } from "@/lib/sources/source-display";

export function SourceDirectoryPreview({ directory }: { directory: SourceDirectory }) {
  const references = directory.publicReferences;
  const registry = directory.registry;
  return (
    <section aria-labelledby="source-directory-title" className="mt-10 border-t border-ink pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="source-directory-title" className="font-display text-2xl text-ink">Explore the sources</h2>
        <Link href="/sources" className="min-h-11 py-2 font-mono text-xs text-seal underline">Browse the source library →</Link>
      </div>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-2">
        Public references are available without publisher verification. A listing is distinct from publishing control, content quality, and payment eligibility.
      </p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-ink-2">
        <span>{references.status === "ready" ? `${references.entries.length} public reference${references.entries.length === 1 ? "" : "s"}` : "Public reference count unavailable"}</span>
        <span>{registry.status === "ready" ? `${registry.entries.length} creator listing${registry.entries.length === 1 ? "" : "s"}` : "Creator listing count unavailable"}</span>
      </div>
      {references.status === "unavailable" && <p role="status" className="mt-4 text-sm text-ink-2">Public reference snapshots could not be loaded. Reload to retry.</p>}
      {references.status === "ready" && references.entries.length > 0 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {references.entries.slice(0, 3).map(reference => <PublicReferenceCard key={reference.id} reference={reference} compact />)}
        </div>
      )}
      {references.status === "ready" && references.entries.length === 0 && registry.entries.length === 0 && registry.status === "ready" && (
        <p className="mt-4 text-sm text-ink-2">No retained sources are listed yet. Keryx can still discover supported public documents in response to a question.</p>
      )}
      {registry.status === "ready" && registry.entries.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {registry.entries.slice(0, references.entries.length ? 3 : 6).map(entry => (
            <Link key={entry.source.id} href={`/creator/${encodeURIComponent(entry.source.id)}`} className="min-w-0 border border-line bg-paper p-4 hover:bg-paper-2">
              <p className="font-display text-lg text-ink">{entry.source.name}</p>
              <p className="mt-2 font-mono text-[11px] text-ink-3">Creator listing · {publisherControlLabel(entry)}</p>
              {entry.source.description && <p className="mt-2 line-clamp-2 text-sm text-ink-2">{entry.source.description}</p>}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
