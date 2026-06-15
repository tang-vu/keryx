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
  onCitationClick?: (marker: string) => void;
}

const CITATION_RE = /\[(S\d+)\]/g;
const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(INLINE_RE).filter(Boolean);
  return parts.map((part, i) => {
    const key = `${keyBase}-i${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-foreground">
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
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
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
  onCitationClick?: (marker: string) => void,
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
        onClick={() => onCitationClick?.(marker)}
        title={cite ? `${cite.sourceName} — ${Math.round(cite.weight * 100)}% weight` : marker}
        className="mx-0.5 inline-flex -translate-y-1.5 items-center rounded bg-amber-500/15 px-1.5 text-[0.7em] font-semibold text-amber-700 align-baseline transition-colors hover:bg-amber-500/25"
      >
        {marker}
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
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  return (
    <div className={cn("space-y-4 text-[15px] leading-relaxed text-foreground/90", className)}>
      {blocks.map((block, bi) => {
        const trimmed = block.trim();
        const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
        if (heading) {
          const level = heading[1].length;
          const content = renderWithCitations(
            heading[2],
            citations,
            `h${bi}`,
            onCitationClick,
          );
          const cls =
            level === 1
              ? "text-lg font-semibold tracking-tight text-foreground"
              : level === 2
                ? "text-base font-semibold tracking-tight text-foreground"
                : "text-sm font-semibold uppercase tracking-wide text-muted-foreground";
          return (
            <p key={`b${bi}`} className={cls}>
              {content}
            </p>
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
