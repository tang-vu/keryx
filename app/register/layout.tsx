import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";

export const metadata: Metadata = { alternates: englishPublicAlternates("/register") };

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
