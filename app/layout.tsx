import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Spectral, Spline_Sans_Mono } from "next/font/google";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { PaperGrain } from "@/components/keryx/paper-grain";
import { InkBleedCursor } from "@/components/keryx/ink-bleed-cursor";
import { MintEngravings } from "@/components/keryx/mint-engravings";
import { Providers } from "./providers";
import { makeConfig } from "@/lib/wagmi-config";
import "./globals.css";

// Public origin for OG/canonical metadata. Explicit BASE_URL wins (set to the live
// Cloudflare Tunnel domain); fall back to Vercel preview URL, then the prod domain, then localhost.
const defaultUrl =
  process.env.BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  (process.env.NODE_ENV === "production" ? "https://keryx.cc" : "http://localhost:3000");

const TITLE = "Keryx — citations are currency";
const DESCRIPTION =
  "Keryx is a citation-toll reading agent. Give it a question and a budget — it buys the paid sources worth reading, answers with citations, and settles a weighted nanopayment to every source it cites, in USDC on Arc. Creators are paid every time an AI cites them.";

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
  alternates: { canonical: "/" },
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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Read the incoming cookie header so wagmi can rehydrate wallet connection
  // state on the server, avoiding a flash of "disconnected" on first paint.
  const cookieHeader = (await headers()).get("cookie") ?? undefined;
  const initialState = cookieToInitialState(makeConfig(), cookieHeader);

  return (
    <html lang="en">
      <body
        className={`${bodoni.variable} ${spectral.variable} ${splineMono.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <MintEngravings />
        <PaperGrain />
        <InkBleedCursor />
        <Providers initialState={initialState}>
          <TooltipProvider>{children}</TooltipProvider>
        </Providers>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
