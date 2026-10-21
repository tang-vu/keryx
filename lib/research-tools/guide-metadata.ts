import type { Metadata } from "next";
import { englishPublicAlternates } from "../i18n/public-metadata";
import { breadcrumbJsonLd } from "../seo-structured-data";
import { researchGuidesCopy as copy } from "@/locales/en/research-guides";

export const GUIDE_PUBLISHED = "2026-10-21";
export const GUIDE_PATHS = ["/guides", "/tools/literature-review-matrix", ...copy.guides.map(guide => `/guides/${guide.slug}`)];
export const guideBase = () => (process.env.BASE_URL || "https://keryx.cc").replace(/\/$/, "");
export const findResearchGuide = (slug: string) => copy.guides.find(guide => guide.slug === slug);
export type ResearchGuide = typeof copy.guides[number];

export function researchPageMetadata(path: string, title: string, description: string): Metadata {
  return { title, description, alternates: englishPublicAlternates(path),
    openGraph: { type: "website", title, description, url: path, locale: "en_US", siteName: "Keryx" },
    twitter: { card: "summary_large_image", title, description } };
}

export function researchGuideJsonLd(guide: ResearchGuide, base = guideBase()) {
  const url = `${base}/guides/${guide.slug}`;
  return { "@context": "https://schema.org", "@type": "Article", "@id": `${url}#article`,
    headline: guide.title, description: guide.summary, inLanguage: "en", datePublished: GUIDE_PUBLISHED,
    mainEntityOfPage: url, author: { "@type": "Organization", "@id": `${base}/#org`, name: copy.author, url: base },
    publisher: { "@id": `${base}/#org` },
    citation: guide.sections.flatMap(section => section.referenceUrl ? [section.referenceUrl] : []),
    articleBody: [guide.summary, ...guide.sections.flatMap(section => [section.title, ...section.paragraphs])].join("\n\n") };
}

export function guideBreadcrumbs(title: string, base = guideBase()) {
  return breadcrumbJsonLd(base, [{ name: "Keryx", path: "/" }, { name: copy.navigation, path: "/guides" }, { name: title }]);
}
