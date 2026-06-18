"use client";

/**
 * InkBleedCursor — a vermillion ink wash that blooms under the cursor and bleeds
 * into the paper as you move, then dries away. Built for "The Mint": the ink is
 * seal-red, composited multiply so it stains the ivory paper like real pigment
 * (not a digital glow), with feathered turbulence edges so each blot soaks into
 * the cotton grain rather than sitting as a clean circle.
 *
 * Implementation: one fixed full-viewport canvas, pointer-transparent. A rAF loop
 * fades the whole canvas a touch each frame (the ink "drying" trail) and draws new
 * blots spawned along the pointer path. An SVG turbulence displacement filter on
 * the canvas element gives the organic bleeding edge.
 *
 * Disabled for touch / coarse pointers and prefers-reduced-motion, and paused when
 * the tab is hidden — it's a desktop flourish, never a cost on mobile or a11y.
 */

import { useEffect, useRef } from "react";

interface Blot {
  x: number;
  y: number;
  r: number;       // current radius (eases up to maxR)
  maxR: number;
  growth: number;  // ease factor 0..1
  ink: string;     // rgba colour
}

// Seal vermillion + a few deeper ink-soak variants, so the wash has tonal depth.
const INKS = [
  "192, 56, 28",   // --seal
  "158, 43, 22",   // deeper seal
  "120, 40, 26",   // seal soaking toward ink
];

export function InkBleedCursor() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Only on devices with a real hovering pointer, and only when motion is welcome.
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const blots: Blot[] = [];
    let lastX = 0;
    let lastY = 0;
    let primed = false;
    let raf = 0;
    let running = true;

    // Spawn ink when the pointer has travelled far enough — denser, smaller blots
    // when moving slowly; bigger sparser ones on fast strokes (like a loaded nib).
    const onMove = (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      if (!primed) {
        lastX = x; lastY = y; primed = true; return;
      }
      const dx = x - lastX;
      const dy = y - lastY;
      const dist = Math.hypot(dx, dy);
      if (dist < 7) return;
      lastX = x; lastY = y;

      const speed = Math.min(dist, 60);
      const ink = INKS[(Math.random() * INKS.length) | 0];
      // Main blot — kept small/delicate.
      blots.push({
        x, y, r: 0,
        maxR: 7 + speed * 0.3 + Math.random() * 6,
        growth: 0,
        ink: `rgba(${ink}, ${0.20 + Math.random() * 0.10})`,
      });
      // A feather satellite or two for splatter — lighter, offset, tiny.
      const sat = (Math.random() * 2) | 0;
      for (let i = 0; i < sat; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 4 + Math.random() * (speed * 0.35 + 6);
        blots.push({
          x: x + Math.cos(a) * d,
          y: y + Math.sin(a) * d,
          r: 0,
          maxR: 2.5 + Math.random() * 5,
          growth: 0,
          ink: `rgba(${ink}, ${0.10 + Math.random() * 0.06})`,
        });
      }
      if (blots.length > 240) blots.splice(0, blots.length - 240);
    };

    const draw = () => {
      if (!running) return;
      const w = window.innerWidth;
      const h = window.innerHeight;

      // Dry the existing ink slightly each frame (erase a hair of alpha everywhere)
      // so strokes linger ~1.5s then fade — the lingering trail, not a hard clear.
      // Exponential decay of alpha everywhere → ink dries fully within ~2s of the
      // cursor stopping, so the paper never keeps a permanent stain. ("dần dần hết ố")
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.04)";
      ctx.fillRect(0, 0, w, h);

      // Lay fresh ink.
      ctx.globalCompositeOperation = "source-over";
      for (const b of blots) {
        if (b.growth < 1) {
          b.growth = Math.min(1, b.growth + 0.13);
          // easeOutCubic so it blooms fast then settles.
          const e = 1 - Math.pow(1 - b.growth, 3);
          b.r = b.maxR * e;
        }
        const a = inkAlpha(b.ink);
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, Math.max(0.5, b.r));
        g.addColorStop(0, b.ink);
        g.addColorStop(0.45, b.ink.replace(/, [\d.]+\)$/, `, ${(0.6 * a).toFixed(3)})`));
        g.addColorStop(1, b.ink.replace(/, [\d.]+\)$/, ", 0)"));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Drop fully-grown blots from the active list (canvas already holds their ink).
      for (let i = blots.length - 1; i >= 0; i--) {
        if (blots[i].growth >= 1) blots.splice(i, 1);
      }

      raf = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      running = !document.hidden;
      if (running) raf = requestAnimationFrame(draw);
      else cancelAnimationFrame(raf);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <>
      {/* Turbulence displacement → feathered, fibrous ink-bleed edges. */}
      <svg aria-hidden className="pointer-events-none absolute h-0 w-0">
        <filter id="kxInkFeather" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.016"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="5"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[2] mix-blend-multiply"
        style={{ filter: "url(#kxInkFeather) blur(0.5px)", opacity: 1 }}
      />
    </>
  );
}

/** Pull the alpha out of an `rgba(r, g, b, a)` string. */
function inkAlpha(rgba: string): number {
  const m = rgba.match(/,\s*([\d.]+)\)$/);
  return m ? parseFloat(m[1]) : 0.1;
}
