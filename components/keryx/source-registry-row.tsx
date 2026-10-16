/**
 * One row of the public source registry (/sources). Server-rendered so the
 * catalogue is crawlable: the name links to the source's public earnings page,
 * the on-chain stamp links to the register() transaction on the explorer, and
 * the earnings figure is the lifetime total of real settled payments.
 */

import { createMessages } from "@/lib/i18n/messages";

import Link from "next/link";
import { Link2, ShieldAlert, ShieldCheck } from "lucide-react";
import { fmtUsdc } from "./phase-style";
import type { Source } from "@/lib/types";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import type { SourceClaim } from "@/lib/sources/public-source-claim";
import { publisherControlLabel, safePublisherUrl } from "@/lib/sources/source-display";
import { UiElement, UiMessage, UiRichMessage, UiText } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");


const EXPLORER = browserPaymentProfile().explorerUrl;

/** Preview-depth footnote — only levels that differ from the default earn a mention. */
const PREVIEW_NOTE: Record<string, string> = {
  excerpt: copy("sourceRegistry.excerpt"),
  locked: copy("sourceRegistry.locked"),
};

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export interface RegistryRowProps {
  source: Source;
  totalEarnedUsdc: number | null;
  citationCount: number | null;
  claim?: SourceClaim | null;
  claimPolicyUnavailable?: boolean;
  controlFresh?: boolean;
}

export function SourceRegistryRow({ source: s, totalEarnedUsdc, citationCount, claim, claimPolicyUnavailable, controlFresh }: RegistryRowProps) {
  const previewNote = s.previewDepth ? PREVIEW_NOTE[s.previewDepth] : undefined;
  const publisherUrl = safePublisherUrl(s.url);
  const controlLabel = publisherControlLabel({ source: s, claim: claim ?? null, claimPolicyUnavailable: claimPolicyUnavailable ?? false, controlFresh: controlFresh ?? false });

  return (
    <article className="border border-ink bg-paper p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/creator/${encodeURIComponent(s.id)}`}
            className="font-display text-[19px] font-medium leading-snug text-ink transition-colors hover:text-seal"
          >
            {s.name}
          </Link>
          {publisherUrl && (
            <a
              href={publisherUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2.5 font-mono text-[11px] text-ink-3 underline decoration-dotted underline-offset-4 transition-colors hover:text-seal"
            >
              {domainOf(s.url)} ↗
            </a>
          )}
        </div>
        <span className="shrink-0 rounded-md bg-seal/10 px-2 py-0.5 font-mono text-xs font-semibold text-seal">
          <UiMessage messageKey={claim ? "sourceRegistry.claimToll" : "sourceRegistry.toll"} values={{ amount: fmtUsdc(s.fetchPrice) }} />
        </span>
      </div>

      {s.description && (
        <p className="mt-2 line-clamp-2 font-serif text-[15px] leading-[1.5] text-ink-2">
          {s.description}
        </p>
      )}
      {claimPolicyUnavailable ? <p className="mt-3 text-sm text-seal"><UiMessage messageKey={"sourceRegistry.policyUnavailable"} /></p> : claim && <p className="mt-3 text-sm text-ink-2">
        <UiRichMessage messageKey={claim.mode === "free" ? "sourceRegistry.policy.free" : !controlFresh ? "sourceRegistry.policy.expired" : !claim.distributionPermission ? "sourceRegistry.policy.noConsent" : claim.mode === "citation-only" ? "sourceRegistry.policy.citation" : "sourceRegistry.policy.paid"} values={{ inspect: <Link href={`/claim-source?claimId=${encodeURIComponent(claim.id)}`} className="underline"><UiMessage messageKey={"sourceRegistry.inspectClaim"} /></Link> }} />
      </p>}

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
        {s.onchainId &&
          (s.registerTx ? (
            <UiElement as="a" names={["title"]} attributes={{ "href": `${EXPLORER}/tx/${s.registerTx}`, "target": "_blank", "rel": "noopener noreferrer", "title": copy("sourceRegistry.registerTransactionTitle"), "className": "inline-flex items-center gap-1 transition-colors hover:underline" }}>
              <Link2 className="h-3 w-3" />
              <UiMessage messageKey={"sourceRegistry.registeredLink"} />
            </UiElement>
          ) : (
            <UiElement as="span" names={["title"]} attributes={{ "title": copy("sourceRegistry.registeredTitle"), "className": "inline-flex items-center gap-1" }}>
              <Link2 className="h-3 w-3" />
              <UiMessage messageKey={"sourceRegistry.registered"} />
            </UiElement>
          ))}
        {claimPolicyUnavailable ? (
          <span className="inline-flex items-center gap-1 text-ink-3"><ShieldAlert className="h-3 w-3" /><UiMessage messageKey={"sourceRegistry.controlUnavailable"} /></span>
        ) : claim ? (
          <UiElement as="span" names={["title"]} attributes={{ "className": `inline-flex items-center gap-1 ${controlFresh ? "text-paid" : "text-amber-700"}`, "title": copy("sourceRegistry.controlTitle") }}>
            {controlFresh ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
            {controlLabel}
          </UiElement>
        ) : s.verified === false ? (
          <UiElement as="span" names={["title"]} attributes={{ "title": copy("sourceRegistry.unverifiedTitle"), "className": "inline-flex items-center gap-1 text-amber-700" }}>
            <ShieldAlert className="h-3 w-3" />
            <UiMessage messageKey={"sourceRegistry.unverified"} />
          </UiElement>
        ) : (
          <span>{controlLabel}</span>
        )}
        {totalEarnedUsdc !== null && totalEarnedUsdc > 0 && (
          <span className="text-paid">
            {citationCount !== null ? <UiMessage messageKey={citationCount === 1 ? "sourceRegistry.earnings.one" : "sourceRegistry.earnings.other"} values={{ amount: fmtUsdc(totalEarnedUsdc), count: citationCount }} /> : <UiMessage messageKey={"sourceRegistry.earningsUnknown"} values={{ amount: fmtUsdc(totalEarnedUsdc) }} />}
          </span>
        )}
        {totalEarnedUsdc === null && <span><UiMessage messageKey={"sourceRegistry.earningsUnavailable"} /></span>}
        {previewNote && <span>{previewNote}</span>}
        {s.tags.slice(0, 3).map((t) => (
          <span key={t} className="rounded border border-line bg-paper-2 px-1.5 py-0.5 normal-case tracking-normal">
            {t}
          </span>
        ))}
      </div>
    </article>
  );
}
