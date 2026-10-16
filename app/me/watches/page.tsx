import type { Metadata } from "next";
import { createMessages } from "@/lib/i18n/messages";
import { SiteHeader } from "@/components/keryx/site-header";
import { TopicWatchManager } from "@/components/keryx/topic-watch-manager";
import { UiMessage } from "@/lib/i18n/ui-copy";


const copy = createMessages("en");
export const metadata: Metadata = { title: copy("topicWatch.metadataTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function WatchesPage() {
  return <><SiteHeader /><main className="mx-auto max-w-[820px] px-4 py-10 sm:px-8">
    <h1 className="mb-4 font-serif text-2xl text-ink"><UiMessage messageKey={"topicWatch.title"} /></h1><TopicWatchManager />
  </main></>;
}
