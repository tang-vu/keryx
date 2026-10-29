import { createMessages } from "@/lib/i18n/messages";
import { ImageResponse } from "next/og";
import { publicPreviewFonts, publicPreviewFontFamily } from "@/lib/og-fonts";
import { publicPreviewText } from "@/lib/og-text";
import {
  findWantedBrief,
  loadWantedBoard,
  WANTED_DETAIL_LIMIT,
} from "@/lib/wanted-board";

const uiCopy = createMessages("en");

// Recheck publication for every generated image request.
export const dynamic = "force-dynamic";

export const alt = uiCopy("wantedCard.alt");
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function WantedClaimOgImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let claim = uiCopy("wantedCard.fallbackClaim");
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
  const headlineText = await publicPreviewText(headline, { fontSize: 50, maxWidth: 1060, maxHeight: 200, color: "#1B1712" });

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
          fontFamily: publicPreviewFontFamily,
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
          <span>{uiCopy("wantedCard.receipt")}</span>
          <span>{state === "open" ? uiCopy("wantedCard.open") : uiCopy("wantedCard.filled")}</span>
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
            {uiCopy("wantedCard.paidClaim")}
          </div>
          <div style={{ ...(typeof headlineText === "string" ? {} : { display: "flex" as const }), fontSize: 50, lineHeight: 1.08, fontWeight: 700 }}>{headlineText}</div>
        </div>

        <div style={{ display: "flex", gap: 72 }}>
          <Figure value={`${Math.round(coverage * 100)}%`} label={uiCopy("wantedCard.coverage")} accent />
          <Figure value={`${seen}×`} label={uiCopy("wantedCard.demand")} />
          <Figure
            value={state === "open" ? "≤ $0.05" : `${Math.round(filledCoverage * 100)}%`}
            label={state === "open" ? uiCopy("wantedCard.retry") : uiCopy("wantedCard.coverageNow")}
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
                {uiCopy("wantedCard.settlementBoundary")}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 18, color: "#7A6F58", letterSpacing: 2 }}>
            keryx.cc/wanted
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await publicPreviewFonts(state === "open" ? `${claim} ≤` : claim) },
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
