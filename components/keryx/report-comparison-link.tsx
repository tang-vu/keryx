"use client";

import Link from "next/link";
import { useUiCopy } from "@/lib/i18n/ui-copy";
import { reportComparisonCopy } from "@/locales/en/report-comparison";

/** Keep the comparison engine out of the saved-report route's eager bundle. */
export function ReportComparisonLink() {
  const copy = useUiCopy("report-comparison", reportComparisonCopy);
  return <Link href="/research/compare" className="mt-4 inline-block font-mono text-xs text-paid underline underline-offset-4">{copy.link}</Link>;
}
