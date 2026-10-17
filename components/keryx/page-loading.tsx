import Link from "next/link";
import { KeryxWordmark } from "@/components/keryx/keryx-mark";
import { PageLoadingContent } from "./page-loading-content";

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
      <main className="min-h-[calc(100dvh-67px)] bg-paper-2" aria-busy="true">
        <PageLoadingContent />
      </main>
    </>
  );
}
