import { notFound } from "next/navigation";
import { ResearchGuide } from "@/components/keryx/research-guide";
import { findResearchGuide, researchPageMetadata } from "@/lib/research-tools/guide-metadata";
import { researchGuidesCopy } from "@/locales/en/research-guides";

export const dynamicParams = false;
export function generateStaticParams() { return researchGuidesCopy.guides.map(guide => ({ slug: guide.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const guide = findResearchGuide((await params).slug);
  if (!guide) notFound();
  return { ...researchPageMetadata(`/guides/${guide.slug}`, guide.title, guide.description),
    openGraph: { type: "article" as const, title: guide.title, description: guide.description, url: `/guides/${guide.slug}`, publishedTime: "2026-10-21", locale: "en_US", siteName: "Keryx" } };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = findResearchGuide((await params).slug);
  if (!guide) notFound();
  return <ResearchGuide guide={guide} />;
}
