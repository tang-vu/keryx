import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import { PrivateProfileView } from "./private-profile-view";
import { OwnerRunAssignmentInbox } from "@/components/keryx/owner-run-assignment-inbox";
import { createMessages } from "@/lib/i18n/messages";
import { UiMessage } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");

export const metadata: Metadata = { title: copy("privateProfile.metadataTitle"), robots: { index: false, follow: false } };
export default function ProfilePage() {
  return <><SiteHeader /><main className="mx-auto max-w-[820px] px-4 py-10 sm:px-8">
    <h1 className="font-serif text-2xl text-ink"><UiMessage messageKey={"privateProfile.title"} /></h1>
    <p className="mt-2 mb-6 text-sm text-ink-3"><UiMessage messageKey={"privateProfile.privacyBoundary"} /></p>
    <PrivateProfileView />
    <div className="mt-10 border-t border-line pt-8"><OwnerRunAssignmentInbox readOnlyView /></div>
  </main></>;
}
