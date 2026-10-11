import { createMessages } from "@/lib/i18n/messages";
import type { TestnetArchiveInfo } from "@/lib/history/testnet-archive";

const copy = createMessages("en");

export function HistoricalDispatchNote({ archive }: { archive: TestnetArchiveInfo }) {
  return (
    <aside aria-label={copy("historicalReport.label")} className="mb-7 max-w-[860px] border-2 border-seal bg-paper px-5 py-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-seal">
        {copy("historicalReport.kicker")}
      </p>
      <p className="mt-2 font-serif text-[15px] leading-relaxed text-ink-2">
        {copy("historicalReport.notice")}
      </p>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-ink-3">
        {copy("historicalReport.captured", { capturedAt: archive.capturedAt.replace("T", " ").replace("Z", " UTC") })}
      </p>
    </aside>
  );
}
