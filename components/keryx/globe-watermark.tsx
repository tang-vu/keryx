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
    let rot = 0;
    let G = 0;
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
      ctx.clearRect(0, 0, G, G);
      projection.rotate([rot, -18]);
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fillStyle = "#f1ece1";
      ctx.fill();
      ctx.beginPath();
      path(graticule);
      ctx.strokeStyle = "rgba(33,30,24,0.13)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      if (land) {
        ctx.beginPath();
        path(land);
        ctx.fillStyle = "#221c15";
        ctx.fill();
        ctx.beginPath();
        path(borders);
        ctx.strokeStyle = "rgba(241,236,225,0.85)";
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.strokeStyle = "#211e18";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      if (reduced) return;
      rot += 0.3;
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
    window.addEventListener("resize", onResize);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
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
          <circle cx="100" cy="100" r="96" fill="none" stroke="#211e18" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="1.2 7.5" />
        </g>
        <g style={{ transformOrigin: "100px 100px", animation: "kxSpinCCW 5.5s linear infinite" }}>
          <path d="M100 11 A89 89 0 0 1 189 100" fill="none" stroke="#211e18" strokeOpacity="0.5" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M100 189 A89 89 0 0 1 11 100" fill="none" stroke="#211e18" strokeOpacity="0.24" strokeWidth="1.7" strokeLinecap="round" />
        </g>
        <g style={{ transformOrigin: "100px 100px", animation: "kxSpinCW 9s linear infinite" }}>
          <path d="M158 33 A82 82 0 0 1 178 64" fill="none" stroke="#211e18" strokeOpacity="0.3" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M42 167 A82 82 0 0 1 22 136" fill="none" stroke="#211e18" strokeOpacity="0.3" strokeWidth="1.2" strokeLinecap="round" />
        </g>
        <g style={{ transformOrigin: "100px 100px", animation: "kxSpinCW 3.6s linear infinite" }}>
          <circle cx="100" cy="16" r="2.1" fill="#211e18" />
          <circle cx="184" cy="100" r="1.4" fill="#211e18" fillOpacity="0.55" />
        </g>
        <g style={{ transformOrigin: "100px 100px", animation: "kxSpinCCW 6.8s linear infinite" }}>
          <circle cx="100" cy="183" r="1.5" fill="#211e18" fillOpacity="0.5" />
        </g>
      </svg>
      <canvas ref={canvasRef} className="relative z-[1] block" />
    </div>
  );
}
