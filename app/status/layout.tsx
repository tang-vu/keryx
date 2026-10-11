import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";

export const metadata: Metadata = { alternates: englishPublicAlternates("/status") };

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
