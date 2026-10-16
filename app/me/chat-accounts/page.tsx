import type { Metadata } from "next";
import { ChatAccountLinks } from "@/components/keryx/chat-account-links";
import { SiteHeader } from "@/components/keryx/site-header";
import { chatAccountMessages } from "@/locales/en/chat-accounts";
import { UiText } from "@/lib/i18n/ui-copy";



export const metadata: Metadata = { title: chatAccountMessages["page.title"], referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default function ChatAccountsPage() {
  return <><SiteHeader /><main className="mx-auto max-w-2xl px-6 py-10">
    <h1 className="text-2xl font-semibold"><UiText source={chatAccountMessages["page.heading"]} namespaces={["chat-accounts"]} /></h1>
    <p className="my-4"><UiText source={chatAccountMessages["page.description"]} namespaces={["chat-accounts"]} /></p>
    <ChatAccountLinks />
  </main></>;
}
