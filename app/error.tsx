"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Branded route error boundary — catches render/runtime throws inside the layout
 * so the user sees the Mint instead of Next's bare "Application error" screen.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[keryx] route error:", error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-ink-3">Dispatch interrupted</p>
      <h1 className="mt-4 font-display text-[clamp(36px,7vw,72px)] font-semibold leading-none text-ink">
        The press jammed.
      </h1>
      <p className="mt-4 max-w-md font-display text-xl italic text-ink-2">
        Something went wrong rendering this page. Your funds are untouched — nothing settles on a
        failed render.
      </p>
      <div className="mt-8 flex items-center gap-6">
        <button
          onClick={reset}
          className="border-b border-seal pb-1 font-mono text-sm text-seal transition-opacity hover:opacity-70"
        >
          ⟳ Try again
        </button>
        <Link
          href="/"
          className="border-b border-line pb-1 font-mono text-sm text-ink-3 transition-opacity hover:opacity-70"
        >
          ◂ Masthead
        </Link>
      </div>
    </main>
  );
}
