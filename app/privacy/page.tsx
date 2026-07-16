/**
 * /privacy — the privacy policy for keryx.cc and the Keryx browser extension.
 * A Chrome Web Store listing requires a live privacy-policy URL, and a payments
 * product owes its users a plain-language one regardless. Static page; every
 * claim in here mirrors what the code actually does — update it when behavior changes.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";

const TITLE = "Privacy — Keryx";
const DESCRIPTION =
  "What Keryx and its browser extension do — and don't do — with your questions, wallet address, and page data.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/privacy" },
};

const UPDATED = "July 16, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="font-display text-[21px] font-medium tracking-tight text-ink">{title}</h2>
      <div className="mt-2.5 flex flex-col gap-3 font-serif text-[15.5px] leading-[1.6] text-ink-2">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <main className="mx-auto max-w-[760px] px-4 pb-20 pt-12 sm:px-[30px]">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          The fine print
        </div>
        <h1 className="font-display text-[clamp(30px,5vw,44px)] font-medium leading-[1.05] tracking-tight text-ink">
          Privacy policy
        </h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          Last updated {UPDATED} · covers keryx.cc and the Keryx browser extension
        </p>

        <Section title="The short version">
          <p>
            Keryx is a reading agent that answers questions and pays the writers it cites, in USDC
            on the Arc testnet. We keep what the product needs to work and nothing else: no ads, no
            analytics scripts, no trackers, no selling or sharing of data with data brokers. The one
            thing you should know before anything else: <strong className="text-ink">answered
            questions are published</strong> — each answer gets a public permalink and may appear in
            the public archive, because paying creators per citation only works in the open.
          </p>
        </Section>

        <Section title="When you ask a question">
          <p>
            Your question is sent to our server, which sends it to a large-language-model provider
            (Anthropic) to plan the research and write the grounded answer. The question, the
            answer, the agent&apos;s reasoning trace, and the payments it triggered are stored and
            published at a permalink (<span className="font-mono text-[13.5px]">/dispatch/…</span>),
            and canonical questions appear in the public <Link href="/answers" className="text-seal underline underline-offset-2">archive</Link>.
            Don&apos;t put anything in a question you wouldn&apos;t put on a public page.
          </p>
          <p>
            The free, no-wallet tier is rate-limited by IP address. That IP is held in server memory
            only for rate-limiting and is not written to the database or joined to your questions.
          </p>
        </Section>

        <Section title="Wallets and accounts">
          <p>
            Signing in is Sign-In-With-Ethereum: we store your wallet address, your role
            (asker/creator), and a last-seen timestamp. No email, no password, no phone number.
            Everything you do on-chain — registrations, payments, withdrawals — is public on Arc by
            the nature of a blockchain, and Keryx links to it rather than hiding it. Session keys
            for browser co-signing are generated in your browser and never sent to us.
          </p>
        </Section>

        <Section title="If you list a source">
          <p>
            A source&apos;s name, URL, description, prices, and payout wallet are public — that is
            the product. Two things stay private: the webhook URL + signing secret you may register
            for citation notifications, and your content itself, which is stored encrypted on IPFS
            and only decrypted after a payment. API keys are shown to you once and stored only as a
            salted hash; we cannot recover them.
          </p>
        </Section>

        <Section title="The browser extension">
          <p>
            The extension is a thin client. Its only network destination is{" "}
            <span className="font-mono text-[13.5px]">https://keryx.cc</span>. Specifically:
          </p>
          <ul className="ml-5 flex list-disc flex-col gap-2">
            <li>
              When you ask, it sends your question (including text you highlighted, if you used the
              right-click menu or had a selection) and your chosen budget to the Keryx API. Nothing
              is sent until you press Ask.
            </li>
            <li>
              When you pick <em>&ldquo;List this page as a paid source&rdquo;</em>, it opens the
              Keryx register page with that page&apos;s URL and title pre-filled. This is the only
              time a page URL leaves your browser, and it happens because you asked for it.
            </li>
            <li>
              It reads your current text selection only when you open it, to pre-fill the question
              box. It does not read pages in the background, collect browsing history, or inject
              anything into pages.
            </li>
            <li>
              <span className="font-mono text-[13.5px]">chrome.storage.local</span> holds only the
              hand-off between the right-click menu and the popup, on your device. There are no
              analytics or telemetry of any kind in the extension.
            </li>
          </ul>
        </Section>

        <Section title="Third parties we rely on">
          <p>
            Anthropic processes question text to produce answers (per their API terms). Circle and
            the Arc network process the on-chain payments. Pinata pins the encrypted IPFS content
            creators upload. Each sees only what its job requires; none of them get your data for
            advertising.
          </p>
        </Section>

        <Section title="Retention, changes, contact">
          <p>
            Published dispatches and on-chain records are retained indefinitely — they are the
            public ledger the product is built on. Rate-limit state lives in memory and is gone on
            restart. If this policy changes, the date above changes with it. Questions, corrections,
            or deletion requests for off-chain data:{" "}
            <a href="mailto:vutang2212@gmail.com" className="text-seal underline underline-offset-2">
              vutang2212@gmail.com
            </a>
            . On-chain data cannot be deleted by anyone, including us.
          </p>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
