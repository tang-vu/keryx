import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Spectral, Spline_Sans_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { PaperGrain } from "@/components/keryx/paper-grain";
import { InkBleedCursor } from "@/components/keryx/ink-bleed-cursor";
import { MintEngravings } from "@/components/keryx/mint-engravings";
import { safeInlineJson } from "@/lib/safe-json";
import { Providers } from "./providers";
import "./globals.css";

// Public origin for OG/canonical metadata. Explicit BASE_URL wins (set to the live
// Cloudflare Tunnel domain); fall back to Vercel preview URL, then the prod domain, then localhost.
const defaultUrl =
  process.env.BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  (process.env.NODE_ENV === "production" ? "https://keryx.cc" : "http://localhost:3000");

const TITLE = "Keryx — citations are currency";
const DESCRIPTION =
  "AI agents read your writing to answer other people's questions — and you're never paid for it. Keryx is a reading agent that cites its sources and pays the writers it quotes. List your blog and earn every time an AI cites you — settled instantly, no platform cut, no payout minimum.";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: { default: TITLE, template: "%s · Keryx" },
  description: DESCRIPTION,
  applicationName: "Keryx",
  keywords: [
    "Keryx",
    "citation toll",
    "x402",
    "USDC",
    "Arc network",
    "nanopayments",
    "AI agent payments",
    "autonomous agent commerce",
    "stablecoin settlement",
    "creators paid",
    "pay per citation",
    "reading agent",
  ],
  authors: [{ name: "Keryx" }],
  creator: "Keryx",
  category: "technology",
  alternates: {
    canonical: "/",
    types: {
      "application/atom+xml": [{ url: "/answers/feed.xml", title: "Keryx Answer Archive" }],
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
const bodoni = Bodoni_Moda({
  variable: "--font-bodoni",
  display: "swap",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
});
const spectral = Spectral({
  variable: "--font-spectral",
  display: "swap",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
});
const splineMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  display: "swap",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
      slogan: "Citations are currency.",
      description: DESCRIPTION,
    },
    {
      "@type": "WebSite",
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
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
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
    <html lang="en">
      <body
        className={`${bodoni.variable} ${spectral.variable} ${splineMono.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeInlineJson(JSON_LD) }}
        />
        <MintEngravings />
        <PaperGrain />
        <InkBleedCursor />
        <Providers>
          <TooltipProvider>{children}</TooltipProvider>
        </Providers>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
