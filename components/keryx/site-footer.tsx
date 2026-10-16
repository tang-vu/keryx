"use client";

/**
 * The colophon — panel-toned footer with the coin, the Keryx etymology, and the
 * house / docs link columns. Internal routes use next/link; external + the /api/docs
 * route handler open in a new tab. Contract references follow the configured deployment.
 */

import Link from "next/link";
import { KeryxGlyph } from "./keryx-mark";
import { browserPaymentProfile,browserRegistryAddress } from "@/lib/browser-payment-profile";
import { currentArcLabel } from "@/lib/arc-network-display";
import { createMessages } from "@/lib/i18n/messages";

import { productGuideCopy } from "@/locales/en/product-guide";
import { setupCopy } from "@/locales/en/get-started";
import { SUPPORT_MAILTO } from "@/lib/public-support";
import { useLocale } from "@/lib/i18n/locale-context";
import { LanguageSwitcher } from "./language-switcher";
import { useUiRichMessages } from "@/lib/i18n/ui-copy";





const profile=browserPaymentProfile(),EXPLORER=profile.explorerUrl;
const configuredRegistry=browserRegistryAddress();
const REGISTRY = /^0x0{40}$/.test(configuredRegistry)&&profile.testnet?"0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536":configuredRegistry;
const USDC = profile.usdcAddress;

type FooterLink = { label: string; href: string; external?: boolean };

// Product surfaces. "API for agents" is the OpenAPI reference (also the A2A entry point).
function houseLinks(message: ReturnType<typeof createMessages>): FooterLink[] { return [
  { label: message("shellNavigation.ask"), href: "/" },
  { label: productGuideCopy("product.pricing"), href: "/pricing" },
  { label: productGuideCopy("product.about"), href: "/about" },
  { label: message("shellNavigation.operator"), href: "/operator" },
  { label: message("shellNavigation.answers"), href: "/answers" },
  { label: message("shellNavigation.sources"), href: "/sources" },
  { label: message("shellNavigation.literature"), href: "/literature" },
  { label: message("shellNavigation.activity"), href: "/dashboard" },
  { label: message("shellFooter.publicProof"), href: "/proof" },
  { label: message("shellNavigation.creators"), href: "/register" },
  { label: message("shellNavigation.playground"), href: "/playground" },
  { label: message("shellNavigation.research"), href: "/research" },
  { label: message("shellFooter.businessCalculator"), href: "/economics" },
  { label: message("shellFooter.remoteMcp"), href: "/integrations/mcp" },
  { label: message("shellFooter.agentApi"), href: "/api/docs", external: true },
]; }

// Current configured contract references; historical receipt links keep their original rail.
function docsLinks(message: ReturnType<typeof createMessages>): FooterLink[] { return [
  { label: setupCopy.navigation.start, href: "/get-started" },
  { label: setupCopy.navigation.download, href: "/download" },
  { label: setupCopy.navigation.integrations, href: "/integrations" },
  { label: productGuideCopy("product.support"), href: SUPPORT_MAILTO, external: true },
  { label: message("shellFooter.github"), href: "https://github.com/tang-vu/keryx", external: true },
  { label: message("shellFooter.registryContract"), href: `${EXPLORER}/address/${REGISTRY}#code`, external: true },
  { label: message("shellFooter.usdcOnArc"), href: `${EXPLORER}/address/${USDC}`, external: true },
  { label: message("shellFooter.x402Gateway"), href: "https://github.com/circlefin/arc-nanopayments", external: true },
  { label: message("shellFooter.arcNetwork"), href: profile.testnet?"https://docs.arc.network":"https://docs.arc.io", external: true },
  { label: message("shellFooter.privacy"), href: "/privacy" },
  { label: message("shellFooter.terms"), href: "/terms" },
]; }

function FooterCol({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
        {title}
      </div>
      <div className="flex flex-col gap-2.5 font-serif text-[15px] text-ink">
        {links.map((l) =>
          l.external ? (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-seal"
            >
              {l.label}
            </a>
          ) : (
            <Link key={l.href} href={l.href} className="transition-colors hover:text-seal">
              {l.label}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

export function SiteFooter() {
  const richMessage = useUiRichMessages();
  const { message, locale } = useLocale();
  return (
    <footer lang={locale} className="border-t border-ink bg-panel">
      <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-[54px] sm:px-[30px]">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <KeryxGlyph size={24} reeded={false} />
              <span className="font-display text-[21px] font-bold leading-none text-ink">
                Keryx
              </span>
            </div>
            <p lang="en" className="mt-4 max-w-[42ch] font-serif text-[16px] leading-[1.55] text-ink-3">
              {richMessage("shellFooter.etymology", { gap: " ", word: <span className="italic text-ink">κῆρυξ</span> })}
            </p>
          </div>

          <FooterCol title={message("shellFooter.house")} links={houseLinks(message)} />
          <FooterCol title={message("shellFooter.docsAndProof")} links={docsLinks(message)} />
        </div>

        <div className="mt-10 flex flex-wrap justify-between gap-3 border-t border-ink pt-5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
          <span lang="en">{message("shellFooter.copyright", { year: 2026 })}</span>
          <LanguageSwitcher />
          <span lang="en" className="text-seal">{richMessage("shellFooter.originalEvidence", { network: currentArcLabel })}</span>
        </div>
      </div>
    </footer>
  );
}
