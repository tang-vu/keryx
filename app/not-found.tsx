import { createMessages } from "@/lib/i18n/messages";
import Link from "next/link";

const uiCopy = createMessages("en");

/** Branded 404 — renders inside the root layout, so the Mint type system applies. */
export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-ink-3">{uiCopy("pageNotFound.eyebrow")}</p>
      <h1 className="mt-4 font-display text-[clamp(48px,9vw,96px)] font-semibold leading-none text-ink">
        404
      </h1>
      <p className="mt-4 max-w-md font-display text-xl italic text-ink-2">
        {uiCopy("pageNotFound.body")}
      </p>
      <Link
        href="/"
        className="mt-8 border-b border-seal pb-1 font-mono text-sm text-seal transition-opacity hover:opacity-70"
      >
        {uiCopy("pageNotFound.home")}
      </Link>
    </main>
  );
}
