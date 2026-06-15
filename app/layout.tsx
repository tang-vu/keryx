import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Keryx — creators paid every time an AI cites them",
  description:
    "A citation-toll reading agent. It decides which paid sources are worth buying under a budget, answers with citations, and settles a weighted nanopayment to every source it used — in USDC on Arc.",
};

const geistSans = Geist({ variable: "--font-geist-sans", display: "swap", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", display: "swap", subsets: ["latin"] });

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
