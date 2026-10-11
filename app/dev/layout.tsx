import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";

export const metadata: Metadata = { alternates: englishPublicAlternates("/dev") };

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return children;
}
