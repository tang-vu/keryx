import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SponsoredRegistrationForm } from "@/components/keryx/sponsored-registration-form";

export const metadata = { title: "Sponsored source registration — Keryx" };
export default async function SponsoredRegistrationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const claimId = typeof params.claimId === "string" && /^[a-f0-9]{64}$/.test(params.claimId) ? params.claimId : undefined;
  return <div className="min-h-screen bg-paper"><SiteHeader /><main className="mx-auto max-w-2xl px-4 py-10 sm:px-8">
    <h1 className="font-display text-4xl">Publish with sponsored gas</h1>
    <p className="mt-4 text-ink-2">Prove control of your RSS feed, review its terms, then sign the registration. Keryx covers admitted gas within its sponsorship limits. Your wallet keeps control and receives creator payments.</p>
    <SponsoredRegistrationForm claimId={claimId} />
  </main><SiteFooter /></div>;
}
