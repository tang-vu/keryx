"use client";

/**
 * Minimal, dependency-free markdown renderer scoped to what the agent emits:
 * paragraphs, **bold**, *italic*, `code`, and inline [S#] citation markers
 * which become superscript chips that scroll to / highlight the matching
 * source. Intentionally small — not a general markdown engine.
 */

import { Fragment, type ReactNode } from "react";
import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AnswerMarkdownProps {
  text: string;
  citations: Citation[];
  className?: string;
  onCitationClick?: (marker: string, trigger: HTMLButtonElement) => void;
}

const CITATION_RE = /\[(S\d+)\]/g;
const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(INLINE_RE).filter(Boolean);
  return parts.map((part, i) => {
    const key = `${keyBase}-i${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={key}
          className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[0.82em] text-ink [overflow-wrap:anywhere]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function renderWithCitations(
  text: string,
  citations: Citation[],
  keyBase: string,
  onCitationClick?: (marker: string, trigger: HTMLButtonElement) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  let idx = 0;

  while ((m = CITATION_RE.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before) nodes.push(...renderInline(before, `${keyBase}-t${idx}`));
    const marker = m[1];
    const cite = citations.find((c) => c.marker === marker);
    nodes.push(
      <button
        key={`${keyBase}-c${idx}`}
        type="button"
        onClick={(event) => onCitationClick?.(marker, event.currentTarget)}
        title={
          cite
            ? `${cite.itemTitle ? `${cite.itemTitle} · ${cite.sourceName}` : cite.sourceName} — ${Math.round(cite.weight * 100)}% weight`
            : marker
        }
        aria-label={cite ? `Open evidence for ${cite.itemTitle ?? cite.sourceName}` : `Citation ${marker}`}
        className="mx-0.5 inline-flex min-h-7 items-center rounded-sm px-1 align-baseline font-mono text-[0.72em] font-semibold text-seal underline decoration-seal/40 underline-offset-2 transition-colors hover:bg-seal/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
      >
        [{marker.replace(/\D/g, "") || marker}]
      </button>,
    );
    last = m.index + m[0].length;
    idx++;
  }
  const tail = text.slice(last);
  if (tail) nodes.push(...renderInline(tail, `${keyBase}-tend`));
  return nodes;
}

export function AnswerMarkdown({
  text,
  citations,
  className,
  onCitationClick,
}: AnswerMarkdownProps) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
    .map((trimmed) => ({ trimmed, heading: /^(#{1,3})\s+(.*)$/.exec(trimmed) }));
  // Each answer is a section within its host. Normalize the shallowest emitted
  // heading to h2 while preserving the report's relative heading depths.
  const shallowestHeading = blocks.reduce(
    (depth, { heading }) => heading ? Math.min(depth, heading[1].length) : depth,
    3,
  );
  return (
    <div className={cn("space-y-5 font-serif text-[18px] leading-[1.7] text-ink", className)}>
      {blocks.map(({ trimmed, heading }, bi) => {
        if (heading) {
          const level = heading[1].length;
          const Heading = `h${2 + level - shallowestHeading}` as "h2" | "h3" | "h4";
          const content = renderWithCitations(
            heading[2],
            citations,
            `h${bi}`,
            onCitationClick,
          );
          const cls =
            level === 1
              ? "font-serif text-xl tracking-tight text-ink"
              : level === 2
                ? "font-serif text-lg tracking-tight text-ink"
                : "font-mono text-xs font-semibold uppercase tracking-[0.12em] text-ink-3";
          return (
            <Heading key={`b${bi}`} className={cls}>
              {content}
            </Heading>
          );
        }
        return (
          <p key={`b${bi}`}>
            {renderWithCitations(trimmed, citations, `b${bi}`, onCitationClick)}
          </p>
        );
      })}
    </div>
  );
}
