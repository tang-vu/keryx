"use client";

import { useEffect } from "react";

/**
 * Root error boundary — replaces the whole document when the root layout itself throws,
 * so it must render its own <html>/<body> and cannot rely on globals.css or the Mint fonts.
 * Inline styles mirror the Mint palette so it still looks on-brand with zero dependencies.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[keryx] global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem",
          textAlign: "center",
          background: "#f1e9d7",
          color: "#1b1712",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <p
          style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "#7a6f58",
            margin: 0,
          }}
        >
          Dispatch interrupted
        </p>
        <h1 style={{ fontSize: "clamp(36px,7vw,64px)", fontWeight: 600, margin: 0, lineHeight: 1 }}>
          The mint is down.
        </h1>
        <p style={{ fontStyle: "italic", fontSize: "1.25rem", color: "#3a342a", maxWidth: 460, margin: 0 }}>
          Something went wrong at the root. Your funds are untouched — nothing settles on a failed render.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: "1rem",
            background: "none",
            border: "none",
            borderBottom: "1px solid #c0381c",
            paddingBottom: 4,
            fontFamily: "ui-monospace, monospace",
            fontSize: 14,
            color: "#c0381c",
            cursor: "pointer",
          }}
        >
          ⟳ Try again
        </button>
      </body>
    </html>
  );
}
