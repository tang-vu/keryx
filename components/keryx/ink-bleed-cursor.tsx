"use client";

/**
 * InkBleedCursor — a vermillion ink wash that blooms under the cursor and bleeds
 * into the paper as you move, then dries away. Built for "The Mint": the ink is
 * seal-red, composited multiply so it stains the ivory paper like real pigment
 * (not a digital glow), with feathered turbulence edges so each blot soaks into
 * the cotton grain rather than sitting as a clean circle.
 *
 * Implementation: one fixed full-viewport canvas, pointer-transparent. A rAF loop
 * clears the canvas and redraws every live blot each frame; each blot blooms to its
 * radius then its `life` fades from 1 to 0, so strokes linger ~1.5s and then leave
 * the paper completely. An SVG turbulence displacement filter gives the organic edge.
 *
 * Fade is managed per-blot in JS (not via canvas alpha accumulation): an iterative
 * `destination-out` multiply can never reach zero on an 8-bit alpha channel — once a
 * pixel's alpha rounds to a small value it sticks, leaving a permanent stain. Driving
 * each blot's life to 0 and redrawing guarantees the ink dries away with no residue.
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
  growth: number;  // bloom ease factor 0..1
  rgb: string;     // "r, g, b"
  alpha: number;   // peak alpha at full life
  life: number;    // 1 → 0; the ink drying out
}

// Seal vermillion + a few deeper ink-soak variants, so the wash has tonal depth.
const INKS = [
  "192, 56, 28",   // --seal
  "158, 43, 22",   // deeper seal
  "120, 40, 26",   // seal soaking toward ink
];

// Drying is time-based (per second), not per-frame, so the wash always fades over the
// same ~1.3s of wall-clock time even when a fast stroke floods the canvas and the
// frame-rate drops. A per-frame decay stalls under that load and leaves the ink sitting
// on the paper forever — the bug this replaces.
const BLOOM_PER_SEC = 8;   // radius bloom speed → ~0.12s to full size
const DRY_PER_SEC = 0.75;  // life lost per second → ~1.3s of visible life
const MAX_DT = 0.25;       // clamp delta so one janky frame can't jump the animation

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
    let last = 0; // timestamp of the previous frame, for delta-time fading

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
      const rgb = INKS[(Math.random() * INKS.length) | 0];
      // Main blot — kept small/delicate.
      blots.push({
        x, y, r: 0,
        maxR: 7 + speed * 0.3 + Math.random() * 6,
        growth: 0,
        rgb,
        alpha: 0.20 + Math.random() * 0.10,
        life: 1,
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
          rgb,
          alpha: 0.10 + Math.random() * 0.06,
          life: 1,
        });
      }
      if (blots.length > 240) blots.splice(0, blots.length - 240);
    };

    const draw = (now: number) => {
      if (!running) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Elapsed seconds since the last frame (clamped) drives the fade, so it is
      // frame-rate independent — a stall can't keep ink alive past its lifetime.
      if (last === 0) last = now;
      const dt = Math.min((now - last) / 1000, MAX_DT);
      last = now;

      // Wipe last frame entirely; the trail is reconstructed from live blots below,
      // so when the cursor stops and every blot's life hits 0 the paper goes blank —
      // no lingering stain from alpha-rounding residue.
      ctx.clearRect(0, 0, w, h);

      ctx.globalCompositeOperation = "source-over";
      for (let i = blots.length - 1; i >= 0; i--) {
        const b = blots[i];
        if (b.growth < 1) {
          b.growth = Math.min(1, b.growth + dt * BLOOM_PER_SEC);
          // easeOutCubic so it blooms fast then settles.
          b.r = b.maxR * (1 - Math.pow(1 - b.growth, 3));
        } else {
          // Fully bloomed → start drying out.
          b.life -= dt * DRY_PER_SEC;
          if (b.life <= 0) {
            blots.splice(i, 1);
            continue;
          }
        }
        const a = b.alpha * b.life; // fade the whole blot as it dries
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, Math.max(0.5, b.r));
        g.addColorStop(0, `rgba(${b.rgb}, ${a.toFixed(3)})`);
        g.addColorStop(0.45, `rgba(${b.rgb}, ${(a * 0.6).toFixed(3)})`);
        g.addColorStop(1, `rgba(${b.rgb}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      running = !document.hidden;
      if (running) {
        last = 0; // restart the clock so the hidden gap isn't counted as one huge frame
        raf = requestAnimationFrame(draw);
      } else {
        cancelAnimationFrame(raf);
      }
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
