import { createMessages } from "@/lib/i18n/messages";
import { UiElement, UiMessage } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");
/** Public export affordance for the deterministic research receipt. */

interface Props {
  dispatchId: string;
}

export function PortableReceiptPanel({ dispatchId }: Props) {
  const receiptPath = `/api/dispatch/${dispatchId}/receipt`;
  return (
    <UiElement as="section" names={["aria-label"]} attributes={{ "aria-label": copy("portableReceipt.label"), "className": "mt-8 max-w-[860px] border border-ink bg-paper px-5 py-4 sm:px-6" }}>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="max-w-[610px]">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paid">
            <UiMessage messageKey={"portableReceipt.label"} />
          </p>
          <h2 className="mt-1 font-display text-[21px] font-semibold tracking-tight text-ink">
            <UiMessage messageKey={"portableReceipt.title"} />
          </h2>
          <p className="mt-1.5 font-serif text-[14px] leading-relaxed text-ink-2">
            <UiMessage messageKey={"portableReceipt.notice"} />
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href={receiptPath}
            target="_blank"
            rel="noreferrer"
            className="border border-line bg-paper-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 transition-colors hover:border-ink hover:text-ink"
          >
            <UiMessage messageKey={"portableReceipt.view"} />
          </a>
          <a
            href={`${receiptPath}?download=1`}
            className="border border-ink bg-ink px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-paper transition-colors hover:bg-paid"
          >
            <UiMessage messageKey={"portableReceipt.download"} />
          </a>
        </div>
      </div>
    </UiElement>
  );
}
