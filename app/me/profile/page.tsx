import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import { PrivateProfileView } from "./private-profile-view";
export const metadata: Metadata = { title: "My private profile — Keryx", robots: { index: false, follow: false } };
export default function ProfilePage() {
  return <><SiteHeader /><main className="mx-auto max-w-[820px] px-4 py-10 sm:px-8">
    <h1 className="font-serif text-2xl text-ink">My private profile</h1>
    <p className="mt-2 mb-6 text-sm text-ink-3">Only you and keys you explicitly authorize can access this profile. These fields do not verify your identity or change payment ownership.</p>
    <PrivateProfileView />
  </main></>;
}
