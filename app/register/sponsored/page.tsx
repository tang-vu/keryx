import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SponsoredRegistrationForm } from "@/components/keryx/sponsored-registration-form";
import { creatorRegistrationCopy as copy } from "@/locales/en/creator-registration";

export const metadata = { title: copy.pageTitle };
export default async function SponsoredRegistrationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const claimId = typeof params.claimId === "string" && /^[a-f0-9]{64}$/.test(params.claimId) ? params.claimId : undefined;
  return <div className="min-h-screen bg-paper"><SiteHeader /><main className="mx-auto max-w-2xl px-4 py-10 sm:px-8">
    <h1 className="font-display text-4xl">{copy.pageHeading}</h1>
    <p className="mt-4 text-ink-2">{copy.pageExplanation}</p>
    <SponsoredRegistrationForm claimId={claimId} />
  </main><SiteFooter /></div>;
}
