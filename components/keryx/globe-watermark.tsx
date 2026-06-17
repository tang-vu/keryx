"use client";

/**
 * Spinning-globe watermark — the signature flourish behind the hero headline.
 * Real country outlines on an orthographic projection (d3-geo + world-atlas),
 * drawn monochrome on the ivory paper, wrapped in orbiting "whirl" arcs. The
 * parent fades it (low opacity) so it reads as an engraved watermark, not art.
 *
 * d3-geo, topojson-client, and the country atlas are loaded lazily on the
 * client so they never touch the SSR bundle.
 */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function GlobeWatermark({ className }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    let mounted = true;
    let G = 0;
    // Rotation has two layers: a slow ever-advancing idle spin (baseRot) and a
    // cursor-driven nudge the globe eases toward, so it "looks at" the pointer
    // as the mouse moves across the hero, then keeps its majestic drift at rest.
    let baseRot = 0; // idle longitude, always advancing
    let curYaw = 0; // eased longitude actually rendered
    let curPitch = -18; // eased latitude actually rendered
    let targetYawOffset = 0; // cursor-driven longitude lean (deg)
    let targetPitch = -18; // cursor-driven latitude (deg)
    let ctx: CanvasRenderingContext2D | null = null;
    // d3-geo types are loose here; the geo objects are intentionally untyped.
    let projection: any = null;
    let path: any = null;
    let graticule: any = null;
    let land: any = null;
    let borders: any = null;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const sizeNow = () => {
      const root = rootRef.current;
      const canvas = canvasRef.current;
      if (!root || !canvas || !projection) return;
      const S = Math.max(140, Math.round(root.clientWidth || 280));
      G = Math.round(S * 0.78);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(G * dpr);
      canvas.height = Math.round(G * dpr);
      canvas.style.width = `${G}px`;
      canvas.style.height = `${G}px`;
      const c = canvas.getContext("2d");
      if (!c) return;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx = c;
      projection.scale(S * 0.36).translate([G / 2, G / 2]);
    };

    const draw = () => {
      if (!mounted || !ctx || !path) return;
      if (!reduced) {
        baseRot += 0.22;
        // ease the rendered rotation toward (idle spin + cursor lean)
        curYaw += (baseRot + targetYawOffset - curYaw) * 0.06;
        curPitch += (targetPitch - curPitch) * 0.06;
      }
      ctx.clearRect(0, 0, G, G);
      projection.rotate([curYaw, curPitch]);
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fillStyle = "#f1e9d7";
      ctx.fill();
      ctx.beginPath();
      path(graticule);
      ctx.strokeStyle = "rgba(27,23,18,0.13)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      if (land) {
        ctx.beginPath();
        path(land);
        ctx.fillStyle = "#22190f";
        ctx.fill();
        ctx.beginPath();
        path(borders);
        ctx.strokeStyle = "rgba(241,233,215,0.85)";
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.strokeStyle = "#1b1712";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      if (reduced) return;
      raf = requestAnimationFrame(draw);
    };

    (async () => {
      const [{ geoOrthographic, geoPath, geoGraticule10 }, topojson] =
        await Promise.all([import("d3-geo"), import("topojson-client")]);
      if (!mounted) return;
      projection = geoOrthographic().clipAngle(90).precision(0.4);
      graticule = geoGraticule10();
      sizeNow();
      path = geoPath(projection, ctx!);
      draw(); // spin the ocean disc + graticule immediately
      // Country borders stream in from the world atlas (cached CDN); the globe
      // degrades gracefully to a blank ocean disc if the fetch fails.
      const w = await fetch(
        "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
      )
        .then((r) => r.json())
        .catch(() => null as any);
      if (!mounted || !w) return;
      land = topojson.feature(w, w.objects.countries);
      borders = topojson.mesh(w, w.objects.countries, (a, b) => a !== b);
      if (reduced) draw(); // animated path keeps drawing via rAF; static needs a nudge
    })();

    const onResize = () => {
      sizeNow();
      if (reduced) draw();
    };

    // Steer the globe toward the cursor: map pointer position (viewport-relative,
    // [-1,1]) onto a longitude lean and latitude tilt. The draw loop eases into it.
    const onPointerMove = (e: PointerEvent) => {
      if (reduced) return;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      targetYawOffset = Math.max(-1, Math.min(1, nx)) * 34;
      targetPitch = -18 + Math.max(-1, Math.min(1, ny)) * 22;
    };
    // Cursor left the window — drift back to the neutral idle pose.
    const onMouseLeave = () => {
      targetYawOffset = 0;
      targetPitch = -18;
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden
      className={cn(
        "pointer-events-none relative flex aspect-square items-center justify-center",
        className,
      )}
    >
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        <g style={{ transformOrigin: "100px 100px", animation: "kxSpinCW 17s linear infinite" }}>
          <circle cx="100" cy="100" r="96" fill="none" stroke="#1b1712" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="1.2 7.5" />
        </g>
        <g style={{ transformOrigin: "100px 100px", animation: "kxSpinCCW 5.5s linear infinite" }}>
          <path d="M100 11 A89 89 0 0 1 189 100" fill="none" stroke="#1b1712" strokeOpacity="0.5" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M100 189 A89 89 0 0 1 11 100" fill="none" stroke="#1b1712" strokeOpacity="0.24" strokeWidth="1.7" strokeLinecap="round" />
        </g>
        <g style={{ transformOrigin: "100px 100px", animation: "kxSpinCW 9s linear infinite" }}>
          <path d="M158 33 A82 82 0 0 1 178 64" fill="none" stroke="#1b1712" strokeOpacity="0.3" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M42 167 A82 82 0 0 1 22 136" fill="none" stroke="#1b1712" strokeOpacity="0.3" strokeWidth="1.2" strokeLinecap="round" />
        </g>
        <g style={{ transformOrigin: "100px 100px", animation: "kxSpinCW 3.6s linear infinite" }}>
          <circle cx="100" cy="16" r="2.1" fill="#1b1712" />
          <circle cx="184" cy="100" r="1.4" fill="#1b1712" fillOpacity="0.55" />
        </g>
        <g style={{ transformOrigin: "100px 100px", animation: "kxSpinCCW 6.8s linear infinite" }}>
          <circle cx="100" cy="183" r="1.5" fill="#1b1712" fillOpacity="0.5" />
        </g>
      </svg>
      <canvas ref={canvasRef} className="relative z-[1] block" />
    </div>
  );
}
