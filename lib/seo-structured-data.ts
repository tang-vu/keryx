/**
 * Shared schema.org builders for the crawlable surfaces.
 *
 * Breadcrumbs are the piece worth centralising: search engines render them in place of the raw URL
 * under a result, and a dispatch permalink is otherwise a bare id that tells a reader nothing about
 * where in the site it sits. Every public page declares the same trail shape from here, so the
 * hierarchy a crawler infers matches the one the header links actually describe.
 */

export interface Crumb {
  name: string;
  /** Site-relative path, e.g. "/answers". Omit on the current page — the last crumb needs no link. */
  path?: string;
}

/** A BreadcrumbList for one page. `base` is the public origin, without a trailing slash. */
export function breadcrumbJsonLd(base: string, crumbs: Crumb[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.path ? { item: `${base}${c.path}` } : {}),
    })),
  };
}

/** Trim a title-ish string for structured data, which should carry a label rather than an essay. */
export function crumbLabel(text: string, max = 70): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
