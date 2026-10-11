import { createMessages } from "@/lib/i18n/messages";
import { ImageResponse } from "next/og";
import { config } from "@/lib/config";
import { resolveDispatch } from "@/lib/history/read-dispatch";
import { publicPreviewFonts, publicPreviewFontFamily } from "@/lib/og-fonts";

const copy = createMessages("en");

export const alt = copy("reportSocial.alt");
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic="force-dynamic";
export const revalidate=0;

// Banknote-style social card, rendered per dispatch so every shared permalink shows
// the real question + how much reached creators — not the generic site masthead.
export default async function DispatchOgImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let question = copy("reportSocial.fallback");
  let cited = 0;
  let spent = 0;
  let toCreators = 0;
  let dateLabel = "";
  let networkLabel = config.profile.testnet ? "Arc testnet" : "Arc mainnet";
  let historical = false;

  try {
    const dispatch = await resolveDispatch(id);
    if (dispatch?.visibility==="public") {
      const { run, archive } = dispatch;
      historical = Boolean(archive);
      if (archive) networkLabel = copy("reportSocial.historical");
      question = run.question;
      cited = run.citations.length;
      spent = run.totalSpent;
      toCreators = run.totalToCreators;
      dateLabel = new Date(run.createdAt).toISOString().slice(0, 10);
    }
  } catch {
    // fall back to generic copy below
  }

  // Trim the question so it fits ~3 lines at the headline size.
  const headline = question.length > 120 ? `${question.slice(0, 117)}…` : question;
  // Deterministic banknote serial from the dispatch id.
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
          <span>{copy("reportSocial.network", { network: networkLabel })}</span>
          <span>{copy("reportSocial.serial", { serial: serialLabel })}</span>
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
            {copy("reportSocial.questionLabel")}
          </div>
          <div style={{ fontSize: 52, lineHeight: 1.08, fontWeight: 700 }}>
            {headline}
          </div>
        </div>

        <div style={{ display: "flex", gap: 56 }}>
          <Denomination value={String(cited)} label={copy(cited === 1 ? "reportSocial.cited.one" : "reportSocial.cited.other")} />
          <Denomination value={`$${spent.toFixed(4)}`} label={historical ? copy("reportSocial.testnetRecorded") : copy("reportSocial.recorded")} />
          <Denomination
            value={`$${toCreators.toFixed(4)}`}
            label={copy("reportSocial.creators")}
            accent
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
                {copy("reportSocial.tagline")}
              </div>
            </div>
          </div>
          {dateLabel ? (
            <div style={{ fontSize: 18, color: "#7A6F58", letterSpacing: 2 }}>
              {dateLabel}
            </div>
          ) : null}
        </div>
      </div>
    ),
    { ...size, fonts: await publicPreviewFonts(question),headers:{"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow"} },
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
