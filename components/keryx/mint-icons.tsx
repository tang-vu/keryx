/**
 * The Engraver's Set — 18 bespoke icons drawn on a shared 24px grid with an
 * even 1.6 stroke, lifted verbatim from the Keryx brand sheet. Each inherits
 * `currentColor` (ink on paper, paper on ink, vermillion when it must speak).
 */

import { cn } from "@/lib/utils";

type Stroke = { d?: string; c?: [number, number, number]; f?: boolean };

const ICONS = {
  herald: [{ d: "M3.5 14 L3.5 10 L13 6.5 L13 17.5 Z" }, { d: "M13 9 L16.5 9" }, { d: "M16 8.6 L18.6 7.8" }, { d: "M16 12 L19 12" }, { d: "M16 15 L18.4 15.8" }, { d: "M6.5 17.5 L6.5 20 L8.8 20 L8.8 18.4" }],
  coin: [{ c: [12, 12, 8.4] }, { d: "M9.6 8.4 L9.6 15.6" }, { d: "M9.6 12 L13.8 8.4" }, { d: "M9.6 12 L13.8 15.6" }],
  purse: [{ d: "M5.2 9.6 C5.2 9.6 8 7 12 7 C16 7 18.8 9.6 18.8 9.6 L18.2 17.8 C18.1 18.9 17.3 19.5 16.3 19.5 L7.7 19.5 C6.7 19.5 5.9 18.9 5.8 17.8 Z" }, { d: "M8.6 8 C8.6 5.4 15.4 5.4 15.4 8" }, { c: [12, 13.2, 1.2] }],
  source: [{ d: "M12 6.6 C9.5 5.2 5 5.2 4 5.7 L4 18 C5 17.5 9.5 17.5 12 19 C14.5 17.5 19 17.5 20 18 L20 5.7 C19 5.2 14.5 5.2 12 6.6 Z" }, { d: "M12 6.6 L12 19" }],
  citation: [{ d: "M9 6.5 L7 6.5 L7 17.5 L9 17.5" }, { d: "M14 6 L14 18" }, { d: "M11.5 9 L16.5 9" }, { d: "M12.4 14 L15.6 14" }],
  weighted: [{ d: "M5.5 8.5 L18.5 8.5" }, { d: "M12 5.6 L12 18" }, { d: "M9 18 L15 18" }, { c: [12, 5.2, 1.1], f: true }, { d: "M5.5 8.7 L4 12.8" }, { d: "M5.5 8.7 L7 12.8" }, { d: "M4 12.8 C4 14.4 7 14.4 7 12.8" }, { d: "M18.5 8.7 L17 12.8" }, { d: "M18.5 8.7 L20 12.8" }, { d: "M17 12.8 C17 14.4 20 14.4 20 12.8" }],
  wallet: [{ d: "M4.5 8 L16.8 8 C18.1 8 18.6 8.8 18.6 9.8 L18.6 16.6 C18.6 17.7 18 18.4 16.7 18.4 L6 18.4 C5 18.4 4.5 17.8 4.5 16.8 Z" }, { d: "M4.5 8 L14.5 5.6 L14.5 8" }, { d: "M18.6 11.6 L14.6 11.6 L14.6 14.6 L18.6 14.6" }, { c: [15.4, 13.1, 0.9], f: true }],
  "arc-node": [{ c: [12, 12, 2.4] }, { d: "M12 12 L5.6 6.6" }, { d: "M12 12 L19 7.6" }, { d: "M12 12 L12 19.4" }, { c: [5.6, 6.6, 1.6] }, { c: [19, 7.6, 1.6] }, { c: [12, 19.4, 1.6] }],
  "sub-second": [{ d: "M12.6 3.6 L6.6 12.4 L11 12.4 L10.6 20.4 L17 10.4 L12.4 10.4 Z" }],
  paid: [{ c: [12, 12, 8] }, { d: "M8.4 12.2 L10.9 14.7 L15.8 9.4" }],
  dispatch: [{ d: "M20.5 4 L3.5 10.6 L10 13.6 L13 20 Z" }, { d: "M20.5 4 L10 13.6" }],
  forward: [{ d: "M9 6 L15 12 L9 18" }],
  receiving: [{ c: [12, 12, 1.7], f: true }, { d: "M8.8 8.8 C7.3 10.3 7.3 13.7 8.8 15.2" }, { d: "M6.4 6.4 C3.9 8.9 3.9 15.1 6.4 17.6" }, { d: "M15.2 8.8 C16.7 10.3 16.7 13.7 15.2 15.2" }, { d: "M17.6 6.4 C20.1 8.9 20.1 15.1 17.6 17.6" }],
  toll: [{ d: "M4 11.6 L11.6 4 L20 4 L20 12.4 L12.4 20 Z" }, { c: [16, 8, 1.3] }],
  earnings: [{ d: "M4 19 L20 19" }, { d: "M7 19 L7 13" }, { d: "M11 19 L11 8.5" }, { d: "M15 19 L15 14.5" }, { d: "M19 19 L19 6" }],
  ledger: [{ d: "M4.5 6.8 L19.5 6.8" }, { d: "M4.5 12 L19.5 12" }, { d: "M4.5 17.2 L15 17.2" }],
  register: [{ c: [12, 12, 8] }, { d: "M12 8 L12 16" }, { d: "M8 12 L16 12" }],
  settled: [{ c: [12, 12, 8] }, { d: "M12 7.4 L12 12 L15.2 13.6" }],
} satisfies Record<string, Stroke[]>;

export type MintIconName = keyof typeof ICONS;

export function MintIcon({
  name,
  className,
}: {
  name: MintIconName;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" className={cn("block h-full w-full", className)} aria-hidden>
      {ICONS[name].map((p: Stroke, i: number) =>
        p.c ? (
          <circle
            key={i}
            cx={p.c[0]}
            cy={p.c[1]}
            r={p.c[2]}
            fill={p.f ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={1.6}
          />
        ) : (
          <path
            key={i}
            d={p.d}
            fill={p.f ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}
