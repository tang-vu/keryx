import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { CreatorRegistration } from "@/components/keryx/creator-registration";
import { registrationDraft, type RegistrationDraft } from "@/lib/registration-return";
import { creatorRegistrationCopy as copy } from "@/locales/en/creator-registration";

export const metadata = { title: copy.pageTitle };
export default async function SponsoredRegistrationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (typeof value === "string") query.set(name, value); else if (Array.isArray(value)) for (const entry of value) query.append(name, entry);
  let initial: RegistrationDraft = {}, error = "";
  try { initial = registrationDraft(query); }
  catch (value) { error = value instanceof Error ? value.message : copy.feedRequired; }
  return <div className="min-h-screen bg-paper"><SiteHeader /><main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
    <CreatorRegistration initial={initial} initialError={error} />
  </main><SiteFooter /></div>;
}
