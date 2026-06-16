import { ImageResponse } from "next/og";

export const alt = "Keryx — citations are currency";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Social card — the banknote masthead, rendered server-side with system serif.
export default function OpengraphImage() {
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
            fontSize: 22,
            letterSpacing: 4,
            color: "#7A6F58",
            textTransform: "uppercase",
          }}
        >
          <span>x402 · USDC · settled on Arc</span>
          <span>Series 2026 — No. 00481</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 104, lineHeight: 1, fontWeight: 700 }}>Citations are</div>
          <div
            style={{
              fontSize: 104,
              lineHeight: 1,
              fontWeight: 700,
              fontStyle: "italic",
              color: "#1C5D45",
            }}
          >
            currency.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 64,
              border: "4px solid #C0381C",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#C0381C",
              fontSize: 42,
              fontWeight: 700,
            }}
          >
            K
          </div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Keryx</div>
          <div style={{ fontSize: 19, color: "#7A6F58", letterSpacing: 2 }}>
            The citation toll — creators paid every time an AI cites them
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
