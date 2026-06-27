import { ImageResponse } from "next/og";
import { getDb } from "@/lib/db";

export const alt = "Keryx creator — paid in USDC every time an AI cites them";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Banknote-style social card for a creator's earnings page, so when a creator shares
// "an AI paid me" it carries their real name, lifetime USDC earned, and citation count.
export default async function CreatorOgImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let name = "A Keryx creator";
  let earned = 0;
  let citations = 0;
  let rank = 0;

  try {
    const db = await getDb();
    const source = await db.getSource(id);
    if (source) {
      name = source.name;
      // Leaderboard carries the authoritative all-time aggregates + rank.
      const leaderboard = await db.creatorLeaderboard();
      const idx = leaderboard.findIndex((e) => e.sourceId === id);
      if (idx >= 0) {
        earned = leaderboard[idx].totalEarnedUsdc;
        citations = leaderboard[idx].citationCount;
        rank = idx + 1;
      }
    }
  } catch {
    // fall back to generic copy below
  }

  const headline = name.length > 64 ? `${name.slice(0, 61)}…` : name;
  const earnedLabel =
    earned >= 0.1 ? `$${earned.toFixed(2)}` : `$${earned.toFixed(4)}`;
  // Deterministic banknote serial from the source id.
  let serial = 0;
  for (const ch of id) serial = (serial * 31 + ch.charCodeAt(0)) % 100000;
  const serialLabel = String(serial).padStart(5, "0");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#F1E9D7",
          color: "#1B1712",
          padding: 56,
          fontFamily: "Georgia, 'Times New Roman', serif",
          border: "14px solid #1B1712",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 21,
            letterSpacing: 4,
            color: "#7A6F58",
            textTransform: "uppercase",
          }}
        >
          <span>Keryx Creator · paid on Arc</span>
          <span>Series 2026 — No. {serialLabel}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 18,
              letterSpacing: 3,
              color: "#1C5D45",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Earns USDC every time an AI cites them
          </div>
          <div style={{ fontSize: 64, lineHeight: 1.05, fontWeight: 700 }}>
            {headline}
          </div>
        </div>

        <div style={{ display: "flex", gap: 56 }}>
          <Denomination value={earnedLabel} label="USDC earned" accent />
          <Denomination value={String(citations)} label="AI citations" />
          {rank > 0 ? (
            <Denomination value={`#${rank}`} label="on the ledger" />
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 60,
              border: "4px solid #C0381C",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#C0381C",
              fontSize: 38,
              fontWeight: 700,
            }}
          >
            K
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>Keryx</div>
            <div style={{ fontSize: 17, color: "#7A6F58", letterSpacing: 1 }}>
              The citation toll — creators paid every time an AI cites them
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

// One banknote "denomination" figure — big serif numeral over a muted caption.
function Denomination({
  value,
  label,
  accent,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          fontSize: 60,
          lineHeight: 1,
          fontWeight: 700,
          color: accent ? "#1C5D45" : "#1B1712",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 18,
          letterSpacing: 2,
          color: "#7A6F58",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
}
