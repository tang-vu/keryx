import { createMessages } from "@/lib/i18n/messages";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { chatAccountFragmentBootstrap } from "@/lib/chat-accounts/fragment-intake";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { PaperGrain } from "@/components/keryx/paper-grain";
import { InkBleedCursor } from "@/components/keryx/ink-bleed-cursor";
import { MintEngravings } from "@/components/keryx/mint-engravings";
import { safeInlineJson } from "@/lib/safe-json";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { productGuideCopy } from "@/locales/en/product-guide";
import { SUPPORT_EMAIL } from "@/lib/public-support";
import { Providers } from "./providers";
import { MaintenanceBanner } from "@/components/keryx/maintenance-banner";
import "./globals.css";

const uiCopy = createMessages("en");

// Public origin for OG/canonical metadata. Explicit BASE_URL wins (set to the live
// Cloudflare Tunnel domain); fall back to Vercel preview URL, then the prod domain, then localhost.
const defaultUrl =
  process.env.BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  (process.env.NODE_ENV === "production" ? "https://keryx.cc" : "http://localhost:3939");

const TITLE = productGuideCopy("product.metaTitle");
const DESCRIPTION =
  productGuideCopy("product.metaDescription");

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: { default: TITLE, template: "%s · Keryx" },
  description: DESCRIPTION,
  applicationName: "Keryx",
  keywords: [
    "Keryx",
    uiCopy("landingMetadata.citationToll"),
    "x402",
    "USDC",
    "Arc network",
    uiCopy("landingMetadata.nanopayments"),
    uiCopy("landingMetadata.agentPayments"),
    uiCopy("landingMetadata.agentCommerce"),
    uiCopy("landingMetadata.stablecoinSettlement"),
    uiCopy("landingMetadata.creatorsPaid"),
    uiCopy("landingMetadata.payPerCitation"),
    uiCopy("landingMetadata.readingAgent"),
  ],
  authors: [{ name: "Keryx" }],
  creator: "Keryx",
  category: "technology",
  alternates: {
    ...englishPublicAlternates("/"),
    types: {
      "application/atom+xml": [{ url: "/answers/feed.xml", title: uiCopy("landingMetadata.archiveFeed") }],
    },
  },
  openGraph: {
    type: "website",
    siteName: "Keryx",
    title: TITLE,
    description: DESCRIPTION,
    url: defaultUrl,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export const viewport: Viewport = {
  themeColor: "#F1E9D7",
  colorScheme: "light",
};

// "The Mint" type system: Bodoni Moda (engraved denomination display),
// Spectral (literary reading + UI), Spline Sans Mono (labels, figures, tolls).
// Multi-face families load the weights/styles the page actually uses through CSS.
// next/font's preload flag applies to every src: preloading these two families
// would eagerly fetch all ten faces on every route, including unused italics.
const bodoni = localFont({
  src: [
    { path: "./fonts/bodoni-moda-latin.woff2", weight: "400 800", style: "normal" },
    { path: "./fonts/bodoni-moda-latin-italic.woff2", weight: "400 800", style: "italic" },
  ],
  variable: "--font-bodoni",
  display: "swap",
  preload: false,
});
const spectral = localFont({
  src: [
    { path: "./fonts/spectral-latin-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/spectral-latin-italic-300.woff2", weight: "300", style: "italic" },
    { path: "./fonts/spectral-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/spectral-latin-italic-400.woff2", weight: "400", style: "italic" },
    { path: "./fonts/spectral-latin-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/spectral-latin-italic-500.woff2", weight: "500", style: "italic" },
    { path: "./fonts/spectral-latin-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/spectral-latin-italic-600.woff2", weight: "600", style: "italic" },
  ],
  variable: "--font-spectral",
  display: "swap",
  preload: false,
});
const splineMono = localFont({
  src: "./fonts/spline-sans-mono-latin.woff2",
  variable: "--font-spline-mono",
  display: "swap",
  weight: "400 600",
});

// Structured data — helps search + AI crawlers understand what Keryx is.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${defaultUrl}/#org`,
      name: "Keryx",
      url: defaultUrl,
      slogan: productGuideCopy("product.slogan"),
      description: DESCRIPTION,
      sameAs: ["https://github.com/tang-vu/keryx"],
      contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: SUPPORT_EMAIL },
    },
    {
      "@type": "WebSite",
      inLanguage: "en",
      "@id": `${defaultUrl}/#site`,
      name: "Keryx",
      url: defaultUrl,
      publisher: { "@id": `${defaultUrl}/#org` },
    },
    {
      "@type": "SoftwareApplication",
      name: "Keryx",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: defaultUrl,
      description: DESCRIPTION,
    },
  ],
};

/**
 * Deliberately reads NO request data. The layout used to call headers() to seed wagmi's wallet
 * state from cookies, which made every page in the app render per-request — the answer archive,
 * all ~450 dispatch permalinks, even /privacy — so each crawler hit rebuilt pages that change a
 * few times an hour. It bought very little: the header's real state comes from the SIWE session,
 * which is fetched client-side anyway. Wallet connection is now restored on the client (wagmi
 * reconnects from the same cookie storage) and the header shows a settling chip meanwhile.
 *
 * Keep it request-independent. Anything that needs per-request data belongs in the page, which
 * can opt into dynamic rendering for itself.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr">
      <body
        className={`${bodoni.variable} ${spectral.variable} ${splineMono.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeInlineJson(JSON_LD) }}
        />
        <Script id="keryx-chat-account-fragment" strategy="beforeInteractive">{chatAccountFragmentBootstrap}</Script>
        <MintEngravings />
        <PaperGrain />
        <InkBleedCursor />
        <Providers>
          <MaintenanceBanner />
          <TooltipProvider>{children}</TooltipProvider>
        </Providers>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
