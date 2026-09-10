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

const UPDATED = "September 10, 2026";

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
            on the Arc testnet. <strong className="text-ink">Public research is published.</strong>{" "}
            The separately labeled private research pilot restricts result access to the paying
            account, while Keryx and the disclosed AI provider still process the question.
            Choose the appropriate mode before submitting. We do not sell question or wallet
            data to data brokers. Hosting and wallet services process operational data as
            described below.
          </p>
        </Section>

        <Section title="When you ask a public question">
          <p>
            Your question is sent to our server, which sends it to a configured large-language-model
            provider to plan the research and write the grounded answer. The question, the
            answer, the agent&apos;s reasoning trace, and the payments it triggered are stored and
            published at a permalink (<span className="font-mono text-[13.5px]">/dispatch/…</span>),
            and canonical questions appear in the public <Link href="/answers" className="text-seal underline underline-offset-2">archive</Link>.
            Don&apos;t put anything in a question you wouldn&apos;t put on a public page.
          </p>
          <p>
            The free, no-wallet tier is rate-limited by a one-way bucket derived from the IP address.
            The raw IP is not written to the database or joined to your questions; expired limiter
            buckets are deleted automatically.
          </p>
        </Section>

        <Section title="Private research pilot">
          <p>
            Private purchasing is limited to configured Arc testnet pilot accounts. The private
            checkout shows the AI provider, model and endpoint before you buy. Keryx and that
            provider process your question; this is not end-to-end encryption. The private
            result and history routes require sign-in as the paying account. Private jobs use
            separate storage and are excluded from the public research archive and public
            payment activity. Payment records on the underlying network may still be public.
          </p>
          <p>
            The browser asks you to accept saving the private question and payment signature
            locally before purchase. Recovery files also contain the question and signature in
            plaintext. Keep exports in private storage. Importing a file saves a local recovery
            copy; it does not send a new payment. Anyone controlling your browser profile or
            scripts running on this site could access local data.
          </p>
          <p>
            In <Link href="/research" className="text-seal underline underline-offset-2">Research</Link>,
            choose Delete local private data and confirm to remove a saved question and signature
            from the browser journal. A minimal account/job marker remains to prevent another
            submission. An exported file can restore recovery access later. Deletion does not
            cancel a signed or in-flight payment, refund funds, delete the server result, or
            remove exports, backups, disk remnants or copies in other open tabs. Close other
            tabs to clear their displayed copies. This is not secure disk erasure.
          </p>
        </Section>

        <Section title="Aggregate product counters">
          <p>
            Keryx keeps first-party daily counters so we can see where the product is slow or
            confusing: for example, how many landing views became accepted asks and completed
            answers, or how many creator registrations reached verification, a settled citation,
            and a cash-out. Each row contains only a UTC date, an allowlisted event name, and a
            count. It contains no wallet, IP, cookie, fingerprint, user agent, referrer, question,
            source, or payment identifier. Landing counting uses tab-local session storage only to
            avoid counting the same tab repeatedly that day; it creates no stable user id and sends
            requests without credentials. These are event totals, never claimed as unique people.
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
            The configured reasoning provider processes question text to produce answers under its
            API terms. Circle and
            the Arc network process the on-chain payments. Pinata pins the encrypted IPFS content
            creators upload. Their processing is governed by their respective service terms.
          </p>
          <p>
            The website is served through Cloudflare. Its performance beacon can send page-load
            metrics to Cloudflare; see its{" "}
            <a href="https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/" className="text-seal underline underline-offset-2">data collection documentation</a>.
            Wallet connection tools, including MetaMask and WalletConnect when available, also
            communicate with their service providers. WalletConnect operational telemetry has
            been observed on the website. These web services are separate from the extension
            and from Keryx&apos;s aggregate product counters.
          </p>
        </Section>

        <Section title="Retention, changes, contact">
          <p>
            Published dispatches and on-chain records are retained indefinitely — they are the
            public ledger the product is built on. Expired rate-limit buckets are deleted; aggregate
            product counters retain only daily totals. Private pilot records are retained for
            operation and recovery; no automatic server deletion schedule currently applies.
            Local deletion does not remove server records or operational backups. If this policy changes, the date above changes
            with it. Questions, corrections,
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
