import { formatRecordedAmount, formatDate, selectPlural } from "@/lib/i18n/format";
import { createMessages } from "@/lib/i18n/messages";
import { ImageResponse } from "next/og";
import { config } from "@/lib/config";
import { resolveDispatch } from "@/lib/history/read-dispatch";
import { publicPreviewFonts, publicPreviewFontFamily } from "@/lib/og-fonts";
import { recordedReportPreview } from "@/lib/i18n/recorded-report-preview";
import { publicPreviewText } from "@/lib/og-text";
import type { ReactElement } from "react";

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
  let preview: ReturnType<typeof recordedReportPreview> | undefined;

  try {
    const dispatch = await resolveDispatch(id);
    if (dispatch?.visibility==="public") {
      const { run, archive } = dispatch;
      // Prepare the full public projection before replacing generic output. A
      // refused read must not leave a partly populated question or language.
      const publicPreview = recordedReportPreview(run);
      const publicQuestion = run.question;
      const publicCited = run.citations.length;
      const publicSpent = run.totalSpent;
      const publicCreators = run.totalToCreators;
      const date = formatDate(run.createdAt, "en", "UTC", { timeStyle: undefined });
      preview = publicPreview;
      historical = Boolean(archive);
      if (archive) networkLabel = copy("reportSocial.historical");
      question = publicQuestion;
      cited = publicCited;
      spent = publicSpent;
      toCreators = publicCreators;
      dateLabel = date ? `${date.text} UTC` : "Unavailable";
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
  const serialCaption = preview ? preview.serial(serialLabel) : copy("reportSocial.serial", { serial: serialLabel });
  const citedCaption = preview ? preview.citedLabel(cited)
    : copy(selectPlural(cited) === "one" ? "reportSocial.cited.one" : "reportSocial.cited.other");
  const [headlineText, serialText, citedText] = await Promise.all([
    publicPreviewText(headline, { fontSize: 52, maxWidth: 1060, maxHeight: 190, color: "#1B1712" }),
    publicPreviewText(serialCaption,
      { fontSize: 21, maxWidth: 500, maxHeight: 40, color: "#7A6F58" }),
    publicPreviewText(citedCaption,
      { fontSize: 18, maxWidth: 250, maxHeight: 45, color: "#7A6F58" }),
  ]);

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
          <span {...(typeof serialText === "string" ? {} : { style: { display: "flex" as const } })}>{serialText}</span>
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
          <div style={{ ...(typeof headlineText === "string" ? {} : { display: "flex" as const }), fontSize: 52, lineHeight: 1.08, fontWeight: 700 }}>
            {headlineText}
          </div>
        </div>

        <div style={{ display: "flex", gap: 56 }}>
          <Denomination value={String(cited)} label={citedText} />
          <Denomination value={`$${formatRecordedAmount(spent, { minimumFractionDigits: 4 })}`} label={historical ? copy("reportSocial.testnetRecorded") : copy("reportSocial.recorded")} />
          <Denomination
            value={`$${formatRecordedAmount(toCreators, { minimumFractionDigits: 4 })}`}
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
    // The recorded answer can have native captions beside an English original.
    // Select local glyphs from every displayed text field after public admission.
    { ...size, fonts: await publicPreviewFonts([question, serialCaption, citedCaption].join("\n")),headers:{"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow"} },
  );
}

// One banknote "denomination" figure — big serif numeral over a muted caption.
function Denomination({
  value,
  label,
  accent,
}: {
  value: string;
  label: string | ReactElement;
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
          ...(typeof label === "string" ? {} : { display: "flex" as const }),
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
