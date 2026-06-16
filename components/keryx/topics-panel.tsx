/**
 * Most-cited topics — horizontal treasury-green bars derived from real citation
 * data (source tags weighted by citations). Rendered only when the dashboard
 * has enough signal to show it.
 */

export interface Topic {
  name: string;
  pct: number;
}

export function TopicsPanel({ topics }: { topics: Topic[] }) {
  return (
    <div className="border border-ink bg-paper p-6">
      <div className="mb-[18px] font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
        Most-cited topics
      </div>
      {topics.map((t) => (
        <div key={t.name} className="mb-4 last:mb-0">
          <div className="mb-[7px] flex items-baseline justify-between gap-3">
            <span className="min-w-0 flex-1 truncate font-serif text-[14.5px] text-ink">
              {t.name}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-ink-3">{t.pct}%</span>
          </div>
          <div className="h-[5px] overflow-hidden border border-line bg-panel">
            <div className="h-full bg-paid" style={{ width: `${t.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
