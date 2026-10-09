import Link from "next/link";
import type { Metadata } from "next";
import { DecisionReviewMetricsView } from "@/components/keryx/decision-review-metrics";
import { decisionReviewCopy as copy } from "@/lib/research/decision-review-copy";
export const metadata: Metadata = { title: copy.metrics, description: copy.metricsNotice };
export default function DecisionReviewsPage() {
  return <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
    <Link href="/" className="font-mono text-xs text-ink-3">{copy.home}</Link>
    <h1 className="mt-6 font-serif text-3xl text-ink">{copy.metrics}</h1>
    <p className="mt-4 max-w-3xl text-sm text-ink-2">{copy.metricsNotice}</p>
    <p className="mt-3 max-w-3xl text-xs text-ink-3">{copy.metricsCohorts}</p>
    <DecisionReviewMetricsView />
  </main>;
}
