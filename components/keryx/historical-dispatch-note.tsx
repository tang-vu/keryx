import { createMessages } from "@/lib/i18n/messages";
import type { TestnetArchiveInfo } from "@/lib/history/testnet-archive";
import { UiElement, UiMessage } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");

export function HistoricalDispatchNote({ archive }: { archive: TestnetArchiveInfo }) {
  return (
    <UiElement as="aside" names={["aria-label"]} attributes={{ "aria-label": copy("historicalReport.label"), "className": "mb-7 max-w-[860px] border-2 border-seal bg-paper px-5 py-4" }}>
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-seal">
        <UiMessage messageKey={"historicalReport.kicker"} />
      </p>
      <p className="mt-2 font-serif text-[15px] leading-relaxed text-ink-2">
        <UiMessage messageKey={"historicalReport.notice"} />
      </p>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-ink-3">
        <UiMessage messageKey={"historicalReport.captured"} values={{ capturedAt: archive.capturedAt.replace("T", " ").replace("Z", " UTC") }} />
      </p>
    </UiElement>
  );
}
