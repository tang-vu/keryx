"use client";

import Link from "next/link";
import { UiText } from "@/lib/i18n/ui-copy";
import { reportComparisonCopy } from "@/locales/en/report-comparison";

/** Keep the comparison engine out of the saved-report route's eager bundle. */
export function ReportComparisonLink() {
  return <Link href="/research/compare" className="mt-4 inline-block font-mono text-xs text-paid underline underline-offset-4"><UiText source={reportComparisonCopy.link} namespaces={["report-comparison"]} /></Link>;
}
