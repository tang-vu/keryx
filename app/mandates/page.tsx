import type { Metadata } from "next";
import { ResearchMandateWorkspace } from "@/components/keryx/research-mandate-workspace";
import { mandateCopy } from "@/locales/en/research-mandates";

export const metadata: Metadata = { title: mandateCopy.en.metaTitle, description: mandateCopy.en.metaDescription };
export default function MandatesPage() { return <ResearchMandateWorkspace />; }
