import { createMessages } from "@/lib/i18n/messages";

const uiCopy = createMessages("en");
/** Local launch branding: viewing the composer does not contact Product Hunt. */
export function ProductHuntBadge() {
  return <a
    href="https://www.producthunt.com/products/keryx-2?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-keryx-2"
    target="_blank"
    rel="noopener noreferrer"
    aria-label={uiCopy("launchBadge.aria")}
    className="inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-seal"
  >
    <svg
      role="img"
      aria-label={uiCopy("launchBadge.alt")}
      width={250}
      height={54}
      viewBox="0 0 250 54"
      className="h-[54px] w-[250px] max-w-full"
    >
      <rect x="0.5" y="0.5" width="249" height="53" rx="8" fill="white" stroke="#ff6154" />
      <circle cx="28" cy="27" r="17" fill="#ff6154" />
      <path d="M23 38V16h8a7 7 0 0 1 0 14h-4v8h-4Zm4-12h4a3 3 0 0 0 0-6h-4v6Z" fill="white" />
      <text x="54" y="33" fill="#ff6154" fontSize="22" fontWeight="600" fontFamily="system-ui, sans-serif">Product Hunt</text>
    </svg>
  </a>;
}
