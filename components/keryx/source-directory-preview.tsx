import { createMessages } from "@/lib/i18n/messages";
import Link from "next/link";
import type { SourceDirectory } from "@/lib/sources/source-directory";
import { PublicReferenceCard } from "./public-reference-card";
import { publisherControlLabel } from "@/lib/sources/source-display";
import { CitedSourceCard } from "./cited-source-card";
import { UiMessage, UiText } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");

export function SourceDirectoryPreview({ directory }: { directory: SourceDirectory }) {
  const references = directory.publicReferences;
  const registry = directory.registry;
  const cited = directory.citedSources;
  return (
    <section aria-labelledby="source-directory-title" className="mt-10 border-t border-ink pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="source-directory-title" className="font-display text-2xl text-ink"><UiMessage messageKey={"sourcePreview.title"} /></h2>
        <Link href="/sources" className="min-h-11 py-2 font-mono text-xs text-seal underline"><UiMessage messageKey={"sourcePreview.browse"} /></Link>
      </div>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-2">
        <UiMessage messageKey={"sourcePreview.intro"} />
      </p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-ink-2">
        {(cited.status === "unavailable" || cited.entries.length > 0) && <span><UiText source={cited.status === "ready" ? copy(cited.entries.length === 1 ? "sourcePreview.documents.one" : "sourcePreview.documents.other", { count: cited.entries.length }) : copy("sourcePreview.citationUnavailable")} /></span>}
        {(references.status === "unavailable" || references.entries.length > 0) && <span><UiText source={references.status === "ready" ? copy(references.entries.length === 1 ? "sourcePreview.feeds.one" : "sourcePreview.feeds.other", { count: references.entries.length }) : copy("sourcePreview.referenceUnavailable")} /></span>}
        {(registry.status === "unavailable" || registry.entries.length > 0) && <span><UiText source={registry.status === "ready" ? copy(registry.entries.length === 1 ? "sourcePreview.creators.one" : "sourcePreview.creators.other", { count: registry.entries.length }) : copy("sourcePreview.creatorUnavailable")} /></span>}
      </div>
      {cited.status === "ready" && cited.entries.length > 0 && <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{cited.entries.slice(0, 3).map(entry => <CitedSourceCard key={entry.url} entry={entry} compact />)}</div>}
      {references.status === "unavailable" && <p role="status" className="mt-4 text-sm text-ink-2"><UiMessage messageKey={"sourcePreview.snapshotsUnavailable"} /></p>}
      {references.status === "ready" && references.entries.length > 0 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {references.entries.slice(0, 3).map(reference => <PublicReferenceCard key={reference.id} reference={reference} compact />)}
        </div>
      )}
      {cited.status === "ready" && cited.entries.length === 0 && references.status === "ready" && references.entries.length === 0 && registry.entries.length === 0 && registry.status === "ready" && (
        <p className="mt-4 text-sm text-ink-2"><UiMessage messageKey={"sourcePreview.empty"} /></p>
      )}
      {registry.status === "ready" && registry.entries.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {registry.entries.slice(0, references.entries.length ? 3 : 6).map(entry => (
            <Link key={entry.source.id} href={`/creator/${encodeURIComponent(entry.source.id)}`} className="min-w-0 border border-line bg-paper p-4 hover:bg-paper-2">
              <p className="font-display text-lg text-ink">{entry.source.name}</p>
              <p className="mt-2 font-mono text-[11px] text-ink-3"><UiMessage messageKey={"sourcePreview.control"} values={{ control: publisherControlLabel(entry) }} /></p>
              {entry.source.description && <p className="mt-2 line-clamp-2 text-sm text-ink-2">{entry.source.description}</p>}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
