import { Loader2 } from "lucide-react";
import Link from "next/link";
import { KeryxWordmark } from "@/components/keryx/keryx-mark";
import { webHeaderMessages } from "@/locales/en/web-header";
import { UiText } from "@/lib/i18n/ui-copy";



/** Prefetchable shell for public data pages; private document bootstraps keep their own boundary. */
export function PageLoading() {
  return (
    <>
      {/* This shell is replaced when data arrives. A temporary wallet control
          would lose its sign-in intent if connection outlived the fallback. */}
      <header className="sticky top-0 z-50 border-b border-ink bg-paper/90">
        <div className="mx-auto flex h-[66px] max-w-[1180px] items-center px-4 sm:px-[30px]">
          <Link href="/"><KeryxWordmark /></Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1180px] px-4 py-12 sm:px-[30px]" aria-busy="true">
        <p role="status" className="flex items-center gap-3 font-mono text-sm text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <UiText source={webHeaderMessages["shellHeader.loadingPage"]} namespaces={["web-header"]} />
        </p>
      </main>
    </>
  );
}
