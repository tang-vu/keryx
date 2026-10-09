import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { RecordedWalkthrough } from "@/components/keryx/recorded-walkthrough";
import { walkthroughMessages as messages } from "@/locales/en/walkthrough";

export const metadata: Metadata = {
  title: messages.title, description: messages.description, alternates: { canonical: "/walkthrough" },
};

export default function WalkthroughPage() {
  return <div className="min-h-screen bg-paper-2"><SiteHeader /><main className="mx-auto max-w-[900px] px-4 pb-20 pt-12 sm:px-[30px]"><h1 className="font-display text-[clamp(32px,6vw,54px)] leading-tight text-ink">{messages.title}</h1><p className="mt-4 font-serif text-lg leading-relaxed text-ink-2">{messages.description}</p><RecordedWalkthrough /></main><SiteFooter /></div>;
}
