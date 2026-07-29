import { ImageResponse } from "next/og";
import {
  findWantedBrief,
  loadWantedBoard,
  WANTED_DETAIL_LIMIT,
} from "@/lib/wanted-board";

export const alt = "Keryx wanted claim — paid demand, missing evidence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function WantedClaimOgImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let claim = "A claim Keryx was paid to answer — and its corpus left short.";
  let coverage = 0;
  let seen = 0;
  let state: "open" | "filled" = "open";
  let filledCoverage = 0;

  try {
    const brief = findWantedBrief(await loadWantedBoard(WANTED_DETAIL_LIMIT), id);
    if (brief) {
      claim = brief.gap.claim;
      coverage = brief.gap.coverage;
      seen = brief.gap.seen;
      state = brief.state;
      filledCoverage = brief.gap.filledBy?.coverage ?? 0;
    }
  } catch {
    // The generic card remains shareable while the database is unavailable.
  }

  const headline = claim.length > 150 ? `${claim.slice(0, 147)}…` : claim;

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
          <span>Keryx Wanted · demand with a receipt</span>
          <span>{state === "open" ? "Open creator brief" : "Claim filled"}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              fontSize: 18,
              letterSpacing: 3,
              color: "#C0381C",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            A claim the paid corpus could not support
          </div>
          <div style={{ fontSize: 50, lineHeight: 1.08, fontWeight: 700 }}>{headline}</div>
        </div>

        <div style={{ display: "flex", gap: 72 }}>
          <Figure value={`${Math.round(coverage * 100)}%`} label="coverage" accent />
          <Figure value={`${seen}×`} label="paid demand" />
          <Figure
            value={state === "open" ? "≤ $0.05" : `${Math.round(filledCoverage * 100)}%`}
            label={state === "open" ? "bounded retry" : "coverage now"}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
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
                Payout only after verified evidence and real citation settlement
              </div>
            </div>
          </div>
          <div style={{ fontSize: 18, color: "#7A6F58", letterSpacing: 2 }}>
            keryx.cc/wanted
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function Figure({
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
          fontSize: 58,
          lineHeight: 1,
          fontWeight: 700,
          color: accent ? "#C0381C" : "#1B1712",
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 17,
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
