/** Public export affordance for the deterministic research receipt. */

interface Props {
  dispatchId: string;
}

export function PortableReceiptPanel({ dispatchId }: Props) {
  const receiptPath = `/api/dispatch/${dispatchId}/receipt`;
  return (
    <section
      aria-label="Portable research receipt"
      className="mt-8 max-w-[860px] border border-ink bg-paper px-5 py-4 sm:px-6"
    >
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="max-w-[610px]">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paid">
            Portable research receipt
          </p>
          <h2 className="mt-1 font-display text-[21px] font-semibold tracking-tight text-ink">
            Take the evidence trail with you
          </h2>
          <p className="mt-1.5 font-serif text-[14px] leading-relaxed text-ink-2">
            One deterministic JSON bundle binds the answer, visible decisions, exact article
            versions, claim evidence and a Circle-settlement snapshot under SHA-256. Retain the
            digest to detect later changes; the self-check is not a publisher or Keryx signature.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href={receiptPath}
            target="_blank"
            rel="noreferrer"
            className="border border-line bg-paper-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 transition-colors hover:border-ink hover:text-ink"
          >
            View JSON ↗
          </a>
          <a
            href={`${receiptPath}?download=1`}
            className="border border-ink bg-ink px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-paper transition-colors hover:bg-paid"
          >
            Download
          </a>
        </div>
      </div>
    </section>
  );
}
