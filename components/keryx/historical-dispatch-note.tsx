import type { TestnetArchiveInfo } from "@/lib/history/testnet-archive";

export function HistoricalDispatchNote({ archive }: { archive: TestnetArchiveInfo }) {
  return (
    <aside aria-label="Historical dispatch network" className="mb-7 max-w-[860px] border-2 border-seal bg-paper px-5 py-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-seal">
        Arc testnet · Historical dispatch
      </p>
      <p className="mt-2 font-serif text-[15px] leading-relaxed text-ink-2">
        This answer and its original payment evidence were retained before the mainnet migration.
        Testnet USDC and settlement records remain on Arc testnet; they are historical evidence,
        separate from current mainnet spending and creator payout authority.
      </p>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-ink-3">
        Archive captured {archive.capturedAt.replace("T", " ").replace("Z", " UTC")}. Source and
        payment states are frozen at that cutoff; source freshness is not checked against today’s catalog.
      </p>
    </aside>
  );
}
