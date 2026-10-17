import { Loader2 } from "lucide-react";
import { webHeaderMessages } from "@/locales/en/web-header";
import { UiText } from "@/lib/i18n/ui-copy";

/** The same content shell before navigation commits and while route data loads. */
export function PageLoadingContent() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-67px)] w-full max-w-[1180px] flex-col items-center justify-center px-4 py-12 sm:px-[30px]" data-page-loading-content aria-busy="true">
      <div role="status" className="flex flex-col items-center gap-4 font-mono text-sm text-ink-3">
        <Loader2 className="h-7 w-7 text-seal motion-safe:animate-spin" aria-hidden="true" />
        <UiText source={webHeaderMessages["shellHeader.loadingPage"]} namespaces={["web-header"]} />
      </div>
      <div className="mt-10 w-full max-w-xl space-y-4" aria-hidden="true">
        <div className="h-5 w-2/5 bg-ink/10" />
        <div className="h-3 w-full bg-ink/5" />
        <div className="h-3 w-4/5 bg-ink/5" />
        <div className="h-28 border border-line bg-paper" />
      </div>
    </div>
  );
}
