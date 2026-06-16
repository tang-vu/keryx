/**
 * Paper grain — a fixed, full-viewport fractal-noise overlay blended soft-light
 * so the whole surface reads as pressed paper rather than flat digital ivory.
 * Static (no animation), pointer-transparent, very low contrast.
 */

export function PaperGrain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[1] opacity-[0.38] mix-blend-soft-light"
    >
      <svg className="h-full w-full">
        <filter id="kxPaperGrain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.82"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#kxPaperGrain)" />
      </svg>
    </div>
  );
}
