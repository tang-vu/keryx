import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";

export const metadata: Metadata = { alternates: englishPublicAlternates("/playground") };

export default function PlaygroundLayout({ children }: { children: React.ReactNode }) {
  return children;
}
