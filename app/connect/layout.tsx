import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";

export const metadata: Metadata = { alternates: englishPublicAlternates("/connect") };

export default function ConnectLayout({ children }: { children: React.ReactNode }) {
  return children;
}
