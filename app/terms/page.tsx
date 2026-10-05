import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";

export const metadata: Metadata = {
  title: "Terms of service — Keryx",
  description: "Terms for using Keryx research, linked wallets, paid sources and creator payments.",
  alternates: { canonical: "/terms" },
};

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

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <main className="mx-auto max-w-[760px] px-4 pb-20 pt-12 sm:px-[30px]">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          The fine print
        </div>
        <h1 className="font-display text-[clamp(30px,5vw,44px)] font-medium leading-[1.05] tracking-tight text-ink">
          Terms of service
        </h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          Effective October 5, 2026 · Keryx services
        </p>

        <Section title="Using Keryx">
          <p>
            These terms apply when you use Keryx&apos;s hosted research service, connect a
            wallet, buy source access, or list content for sale. The browser extension,
            desktop and agent integrations can connect to the same hosted service. Use
            Keryx only when you are permitted to use it under the laws that apply to you.
          </p>
          <p>
            Keryx produces automated research with citations and visible payment records.
            Answers can be incomplete or mistaken. Check the cited material and use your
            own judgment before acting on an answer, especially for medical, legal or
            financial decisions. Keryx does not guarantee a particular research result or
            creator income.
          </p>
        </Section>

        <Section title="Accounts, wallets and recovery">
          <p>
            You are responsible for the accounts, devices and wallet authorizations you
            use. Where available, Google sign-in connects to a Circle user-controlled
            wallet; signing in does not itself approve spending. Review wallet actions
            and the allowance, duration and question limit before enabling a research budget.
          </p>
          <p>
            A funded browser research key is separate from the linked owner wallet.
            Signing out locks that key but preserves its local recovery data. Clearing
            browser data or losing the device can lose access to it. Google account
            recovery does not automatically restore this research key. Keep any recovery
            exports private and follow the recovery instructions shown in the product.
          </p>
        </Section>

        <Section title="Prices, payments and delivery">
          <p>
            Review the displayed price or spending limit before authorizing a paid action.
            Source access tolls, citation rewards, service fees and network fees can be
            separate charges. A spending allowance permits spending within its limits;
            it does not guarantee that all of the allowance will be used or that every
            selected source will be delivered.
          </p>
          <p>
            Payment records distinguish settled, pending, failed and simulated actions.
            A pending action is not proof of payment completion. If an operation is
            uncertain, use its existing receipt and recovery flow before trying another
            payment. Completed blockchain payments cannot be reversed by Keryx; signing
            out or stopping a budget does not refund funds or cancel already exposed
            payment authorizations. Contact support about an unresolved purchase or
            delivery problem so its original evidence can be reviewed.
          </p>
          <p>
            Circle, wallet providers and the underlying network have their own terms,
            availability and fees. Review those providers&apos; terms when using their services.
          </p>
        </Section>

        <Section title="Questions and creator content">
          <p>
            Public research questions, answers, citations and payment activity can be
            published. Use the separately labeled private research mode where available
            for information you intend to keep out of the public archive, and review its
            processing and recovery disclosures before purchase.
          </p>
          <p>
            Submit or sell only material you have permission to provide. Listing a source
            authorizes Keryx to display its listing information and process and deliver
            the submitted content as needed for the access and citation workflow. It does
            not transfer ownership of your work. A listing does not guarantee purchases
            or rewards; reward eligibility depends on the content actually cited and the
            applicable payment evidence.
          </p>
          <p>
            Do not impersonate another person, misrepresent content ownership, manipulate
            payment evidence, distribute malicious content, or bypass access and spending
            controls. Respect the rights and access terms of the sources you use.
          </p>
        </Section>

        <Section title="Privacy and availability">
          <p>
            The <Link href="/privacy" className="text-seal underline underline-offset-2">privacy policy</Link>{" "}
            describes the information Keryx and its providers process, public records,
            browser storage and deletion limits. Read it before submitting information.
          </p>
          <p>
            Features can change or become unavailable during maintenance, provider
            outages or safety restrictions. Experimental features are labeled in the
            product. Changes to these terms will be published here with an updated
            effective date; they do not create a new wallet signature or increase an
            existing spending allowance.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these terms, content rights, or a purchase:{" "}
            <a href="mailto:vutang2212@gmail.com" className="text-seal underline underline-offset-2">vutang2212@gmail.com</a>.
            Include the relevant source or receipt identifier when available. Do not send
            passwords, private keys or recovery secrets.
          </p>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
