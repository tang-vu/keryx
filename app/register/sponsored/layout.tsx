import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";

export const metadata: Metadata = { alternates: englishPublicAlternates("/register/sponsored") };

export default function SponsoredRegistrationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
