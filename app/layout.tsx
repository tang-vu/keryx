import type { Metadata } from "next";
import { Newsreader, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import "./globals.css";

// Public origin for OG/canonical metadata. Explicit BASE_URL wins (set to the live
// Cloudflare Tunnel domain); fall back to Vercel preview URL, then the prod domain, then localhost.
const defaultUrl =
  process.env.BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  (process.env.NODE_ENV === "production" ? "https://keryx.cc" : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Keryx — creators paid every time an AI cites them",
  description:
    "A citation-toll reading agent. It decides which paid sources are worth buying under a budget, answers with citations, and settles a weighted nanopayment to every source it used — in USDC on Arc.",
};

// "The Mint" type system: Newsreader (engraved serif — headlines + reading),
// Hanken Grotesk (UI sans), IBM Plex Mono (labels, figures, tolls).
const newsreader = Newsreader({
  variable: "--font-newsreader",
  display: "swap",
  subsets: ["latin"],
  style: ["normal", "italic"],
});
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  display: "swap",
  subsets: ["latin"],
});
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  display: "swap",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${newsreader.variable} ${hanken.variable} ${plexMono.variable} antialiased`}
      >
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
