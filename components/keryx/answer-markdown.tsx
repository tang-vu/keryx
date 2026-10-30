"use client";

/**
 * Minimal, dependency-free markdown renderer scoped to what the agent emits:
 * paragraphs, headings, simple bullet lists, **bold**, *italic*, `code`, and inline [S#] citation markers
 * which become superscript chips that scroll to / highlight the matching
 * source. Intentionally small — not a general markdown engine.
 */

import { createMessages } from "@/lib/i18n/messages";
import { Fragment, type ReactNode } from "react";
import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { PresentationLanguage } from "@/lib/research/presentation-language";
import { quotedOriginalSpan } from "@/lib/i18n/quoted-originals";
import { originalTechnicalText } from "@/shared/i18n/original-technical-text";

const copy = createMessages("en");

interface AnswerMarkdownProps {
  text: string;
  citations: Citation[];
  className?: string;
  /** Trusted recorded generated-prose language, independently of the viewer. */
  language?: PresentationLanguage;
  onCitationClick?: (marker: string, trigger: HTMLButtonElement) => void;
}

const CITATION_RE = /\[(S\d+)\]/g;
// Grounded literals put U+200B after each delimiter. Such delimiters are text,
// including inside real markup; neither opening nor closing may consume them.
const INLINE_RE = /(\*\*(?!\u200b)(?:\*\u200b|[^*])+\*(?!\u200b)\*(?!\u200b)|\*(?!\u200b)(?:\*\u200b|[^*])+\*(?!\u200b)|`(?!\u200b)(?:`\u200b|[^`])+`(?!\u200b))/g;

/** Clip the original span from the unsplit text to each displayed fragment. */
function renderOriginalQuotes(text: string, original: ReturnType<typeof quotedOriginalSpan>, offset: number): ReactNode {
  if (!original) return text;
  const start = Math.max(0, original.start - offset);
  const end = Math.min(text.length, original.end - offset);
  if (end <= start) return text;
  return <>{text.slice(0, start)}<bdi lang="und" dir="auto">{originalTechnicalText(text.slice(start, end))}</bdi>{text.slice(end)}</>;
}

function renderInline(
  text: string,
  citations: Citation[],
  keyBase: string,
  original: ReturnType<typeof quotedOriginalSpan>,
  offset: number,
  onCitationClick?: AnswerMarkdownProps["onCitationClick"],
): ReactNode[] {
  // Retain split positions: only odd entries are captured markup. An unmatched
  // text fragment can itself start/end with escaped or unpaired delimiters.
  const parts = text.split(INLINE_RE);
  let cursor = offset;
  return parts.map((part, i) => {
    if (!part) return null;
    const key = `${keyBase}-i${i}`;
    const start = cursor;
    cursor += part.length;
    const markup = i % 2 === 1;
    if (markup && part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {renderCitationText(part.slice(2, -2), citations, key, original, start + 2, onCitationClick)}
        </strong>
      );
    }
    if (markup && part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={key} className="italic">
          {renderCitationText(part.slice(1, -1), citations, key, original, start + 1, onCitationClick)}
        </em>
      );
    }
    if (markup && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={key}
          dir="ltr"
          className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[0.82em] text-ink [overflow-wrap:anywhere]"
        >
          {renderOriginalQuotes(part.slice(1, -1), original, start + 1)}
        </code>
      );
    }
    return <Fragment key={key}>{renderCitationText(part, citations, key, original, start, onCitationClick)}</Fragment>;
  });
}

/** Code spans bypass this pass: citation syntax there is literal text. */
function renderCitationText(
  text: string,
  citations: Citation[],
  keyBase: string,
  original: ReturnType<typeof quotedOriginalSpan>,
  offset: number,
  onCitationClick?: (marker: string, trigger: HTMLButtonElement) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  let idx = 0;

  while ((m = CITATION_RE.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before) nodes.push(<Fragment key={`${keyBase}-t${idx}`}>{renderOriginalQuotes(before, original, offset + last)}</Fragment>);
    const marker = m[1];
    const cite = citations.find((c) => c.marker === marker);
    const title = cite
      ? cite.itemTitle ? copy("reportCitation.articleTitle", { article: cite.itemTitle, publication: cite.sourceName, weight: Math.round(cite.weight * 100) }) : copy("reportCitation.title", { source: cite.sourceName, weight: Math.round(cite.weight * 100) })
      : marker;
    // Compact readers can hand off to the full report instead of an inspector.
    // Without a handler, keep the reference visible without promising an action.
    if (!onCitationClick) {
      nodes.push(<span lang="en" dir="ltr" key={`${keyBase}-c${idx}`} title={title} className="mx-0.5 font-mono text-[0.72em] font-semibold text-seal">
        [{marker.replace(/\D/g, "") || marker}]
      </span>);
      last = m.index + m[0].length;
      idx++;
      continue;
    }
    nodes.push(
      <button
        lang="en"
        dir="ltr"
        key={`${keyBase}-c${idx}`}
        type="button"
        onClick={(event) => onCitationClick?.(marker, event.currentTarget)}
        title={title}
        aria-label={cite ? copy("reportCitation.openEvidence", { source: cite.itemTitle ?? cite.sourceName }) : copy("reportCitation.label", { marker })}
        className="mx-0.5 inline-flex min-h-7 items-center rounded-sm px-1 align-baseline font-mono text-[0.72em] font-semibold text-seal underline decoration-seal/40 underline-offset-2 transition-colors hover:bg-seal/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
      >
        [{marker.replace(/\D/g, "") || marker}]
      </button>,
    );
    last = m.index + m[0].length;
    idx++;
  }
  const tail = text.slice(last);
  if (tail) nodes.push(<Fragment key={`${keyBase}-tend`}>{renderOriginalQuotes(tail, original, offset + last)}</Fragment>);
  return nodes;
}

function renderWithCitations(
  text: string,
  citations: Citation[],
  keyBase: string,
  onCitationClick?: AnswerMarkdownProps["onCitationClick"],
): ReactNode[] {
  // Keep formatting boundaries intact, then find evidence controls in prose.
  // Detect original-quote offsets before either pass splits the text.
  return renderInline(text, citations, keyBase, quotedOriginalSpan(text), 0, onCitationClick);
}

export function AnswerMarkdown({
  text,
  citations,
  className,
  language,
  onCitationClick,
}: AnswerMarkdownProps) {
  const blocks: { trimmed: string; heading: RegExpExecArray | null; list?: string[] }[] = [];
  for (const trimmed of text.split(/\n{2,}/).map(block => block.trim()).filter(Boolean)) {
    const lines = trimmed.split("\n");
    const list = lines.every(line => /^- \S/u.test(line)) ? lines.map(line => line.slice(2)) : undefined;
    const previous = blocks.at(-1);
    if (list && previous?.list) previous.list.push(...list);
    else blocks.push({ trimmed, heading: /^(#{1,3})\s+(.*)$/.exec(trimmed), list });
  }
  // Each answer is a section within its host. Normalize the shallowest emitted
  // heading to h2 while preserving the report's relative heading depths.
  const shallowestHeading = blocks.reduce(
    (depth, { heading }) => heading ? Math.min(depth, heading[1].length) : depth,
    3,
  );
  return (
    // Known Arabic prose reads RTL. Unknown content chooses its reading direction
    // without acquiring a generated-prose language label.
    <div lang={language ?? "und"} dir={language === "ar" ? "rtl" : language ? "ltr" : "auto"} className={cn("space-y-5 font-serif text-[18px] leading-[1.7] text-ink [overflow-wrap:anywhere]", className)}>
      {blocks.map(({ trimmed, heading, list }, bi) => {
        if (list) return (
          <ul key={`b${bi}`} className="list-disc space-y-3 ps-6">
            {list.map((item, index) => <li key={`b${bi}-l${index}`}>
              {renderWithCitations(item, citations, `b${bi}-l${index}`, onCitationClick)}
            </li>)}
          </ul>
        );
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
