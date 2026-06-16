import type { Metadata } from "next";
import { Bodoni_Moda, Spectral, Spline_Sans_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { PaperGrain } from "@/components/keryx/paper-grain";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${bodoni.variable} ${spectral.variable} ${splineMono.variable} antialiased`}
      >
        <PaperGrain />
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
