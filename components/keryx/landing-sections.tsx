/**
 * Landing marketing sections: "The minting" (Decide / Cite / Settle struck as
 * banknote plates with Bodoni numerals + engraver icons + rosette watermarks)
 * and the treasury-green "For creators" plate.
 */

import { createMessages } from "@/lib/i18n/messages";

import Link from "next/link";
import { MintIcon, type MintIconName } from "./mint-icons";
import { cn } from "@/lib/utils";
import { currentArcLabel } from "@/lib/arc-network-display";
import { productGuideCopy } from "@/locales/en/product-guide";
import { aboutStory } from "@/locales/en/about-story";
import { walkthroughMessages } from "@/locales/en/walkthrough";
import { UiMessage, UiRichMessage, UiText } from "@/lib/i18n/ui-copy";

const uiCopy = createMessages("en");

const STEPS: {
  num: string;
  kicker: string;
  icon: MintIconName;
  body: string;
}[] = [
  {
    num: "I",
    kicker: uiCopy("landingSteps.decide"),
    icon: "weighted",
    body: productGuideCopy("product.stepsDecide"),
  },
  {
    num: "II",
    kicker: uiCopy("landingSteps.cite"),
    icon: "citation",
    body: productGuideCopy("product.stepsCite"),
  },
  {
    num: "III",
    kicker: uiCopy("landingSteps.settle"),
    icon: "paid",
    body: uiCopy("landingSteps.settleBody", { network: currentArcLabel }),
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-[1180px] scroll-mt-24 px-4 pb-2.5 pt-12 sm:px-[30px]" aria-labelledby="how-it-works-title">
      <div className="mb-7 flex items-baseline gap-4">
        <h2 id="how-it-works-title" className="font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          <UiText source={productGuideCopy("product.stepsTitle")} namespaces={["product-guide","about-story"]} />
        </h2>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="grid border border-ink bg-paper sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <div
            key={s.kicker}
            className={cn(
              "relative overflow-hidden p-8 sm:p-9",
              i < 2 && "sm:border-r sm:border-ink",
              i > 0 && "border-t border-ink sm:border-t-0",
            )}
          >
            <svg
              viewBox="0 0 200 200"
              className="pointer-events-none absolute -bottom-14 -right-14 h-[200px] w-[200px] text-ink opacity-[0.07]"
            >
              <use href="#eng-rose2" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </svg>
            <span className="absolute right-6 top-8 block h-[26px] w-[26px] text-paid">
              <MintIcon name={s.icon} />
            </span>
            <div className="font-display text-[54px] font-semibold italic leading-none text-seal">
              <UiText source={s.num} />
            </div>
            <div className="mb-2.5 mt-[18px] font-mono text-[11px] uppercase tracking-[0.18em] text-paid">
              <UiText source={s.kicker} />
            </div>
            <p className="relative font-serif text-[16px] leading-[1.55] text-ink-2">
              <UiText source={s.body} />
            </p>
          </div>
        ))}
      </div>
      <Link lang="en" href="/about#in-practice" className="mt-4 inline-flex min-h-11 items-center gap-3 font-serif text-base text-paid underline underline-offset-4 transition-colors hover:text-seal focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-paid">
        <UiText source={aboutStory.landingLink} namespaces={["product-guide","about-story"]} /><span aria-hidden="true">→</span>
      </Link>
      <Link href="/walkthrough" prefetch={false} className="mt-2 flex min-h-11 items-center text-sm text-paid underline underline-offset-4">
        <UiText source={walkthroughMessages.landingLink} namespaces={["walkthrough"]} />
      </Link>
    </section>
  );
}

export function ForCreators() {
  return (
    <section className="mx-auto max-w-[1180px] px-4 py-16 sm:px-[30px]">
      <div className="border-2 border-ink bg-paid p-1.5 text-paper">
        <div className="relative overflow-hidden border border-paper/50 p-8 sm:p-14">
          <svg
            viewBox="0 0 200 200"
            className="pointer-events-none absolute -left-10 -top-10 h-[340px] w-[340px] text-paper opacity-[0.12]"
          >
            <use href="#eng-rose1" fill="none" stroke="currentColor" strokeWidth="0.4" />
          </svg>
          <div className="relative font-mono text-[11px] uppercase tracking-[0.2em] text-paper/75">
            <UiMessage messageKey={"landingSteps.creators"} />
          </div>
          <h2 className="relative mt-4 max-w-[18ch] font-display text-[clamp(32px,5.4vw,72px)] font-medium leading-[0.98] tracking-[-0.01em]">
            <UiRichMessage messageKey={"landingCreators.title"} values={{ emphasis: <em className="font-semibold italic"><UiMessage messageKey={"landingCreators.titleEmphasis"} /></em> }} />
          </h2>
          <p className="relative mt-6 max-w-[54ch] font-serif text-[clamp(16px,1.5vw,19px)] leading-[1.55] text-paper/85">
            <UiMessage messageKey={"landingCreators.introduction"} values={{ network: currentArcLabel }} />
          </p>
          <div className="relative mt-8 flex flex-wrap gap-3">
            <Link
              href="/register"
              className="border border-paper bg-paper px-6 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-ink transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_rgba(15,42,30,0.6)] active:translate-y-0 active:shadow-none"
            >
              <UiMessage messageKey={"landingSteps.listFeed"} />
            </Link>
            <Link
              href="/dashboard"
              className="border border-paper/55 px-6 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-paper transition-colors hover:bg-paper hover:text-paid"
            >
              <UiMessage messageKey={"landingSteps.ledger"} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
