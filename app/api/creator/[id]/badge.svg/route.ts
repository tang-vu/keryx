/**
 * GET /api/creator/[id]/badge.svg — an embeddable "Cited by Keryx" badge.
 *
 * Returns a self-contained, shields.io-style flat SVG showing a creator's live
 * citation count + total USDC earned, so any creator can drop
 *   <img src="https://keryx.cc/api/creator/<id>/badge.svg" alt="Cited by Keryx">
 * onto their blog and show — verifiably — that agents pay them per citation.
 * Public, no auth. Cached 5 min so embeds don't hammer the datastore.
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verdana ~11px average glyph advance. Enough to size a two-segment badge without
// embedding a font-metrics table; a couple px of slack never hurts a flat badge.
const CHAR_W = 6.2;
const PAD = 8; // horizontal padding inside each segment
const H = 20; // badge height, shields.io flat convention

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function segWidth(text: string): number {
  return Math.round(text.length * CHAR_W + PAD * 2);
}

/** Build a two-segment flat badge: dark-ink label + colored value, both parchment text. */
function badge(label: string, value: string, valueBg: string): string {
  const lw = segWidth(label);
  const vw = segWidth(value);
  const w = lw + vw;
  const lx = lw / 2;
  const vx = lw + vw / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <title>${esc(label)}: ${esc(value)}</title>
  <linearGradient id="g" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".12"/>
    <stop offset="1" stop-opacity=".12"/>
  </linearGradient>
  <clipPath id="r"><rect width="${w}" height="${H}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="${H}" fill="#1b1712"/>
    <rect x="${lw}" width="${vw}" height="${H}" fill="${valueBg}"/>
    <rect width="${w}" height="${H}" fill="url(#g)"/>
  </g>
  <g fill="#f1e9d7" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lx}" y="15" fill="#000" fill-opacity=".3">${esc(label)}</text>
    <text x="${lx}" y="14">${esc(label)}</text>
    <text x="${vx}" y="15" fill="#000" fill-opacity=".3">${esc(value)}</text>
    <text x="${vx}" y="14">${esc(value)}</text>
  </g>
</svg>`;
}

function svg(body: string, maxAge = 300): Response {
  return new Response(body, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // Short-lived cache: fresh enough to feel live, cheap enough to embed anywhere.
      "cache-control": `public, max-age=${maxAge}, s-maxage=${maxAge}`,
    },
  });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const db = await getDb();
    const source = await db.getSource(id);
    if (!source) {
      // Always answer with a renderable badge (never a broken <img>) — shields.io convention.
      return svg(badge("cited by keryx", "unknown source", "#7a6f58"), 60);
    }
    const entry = (await db.creatorLeaderboard()).find((e) => e.sourceId === id);
    const citations = entry?.citationCount ?? 0;
    const earned = entry?.totalEarnedUsdc ?? 0;
    return svg(badge("cited by keryx", `${citations}× · $${earned.toFixed(2)}`, "#c0381c"));
  } catch {
    return svg(badge("cited by keryx", "unavailable", "#7a6f58"), 30);
  }
}
