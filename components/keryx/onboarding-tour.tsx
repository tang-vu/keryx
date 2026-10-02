"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { currentArcLabel } from "@/lib/arc-network-display";

const steps = [
  { target: "hero", title: "Research with a budget", body: "Keryx finds sources, explains what it buys or skips, and cites evidence in its answer." },
  { target: "ask-form", title: "Ask a question", body: "Enter the research question you want answered. You can inspect decisions as the answer streams." },
  { target: "budget", title: "Choose a spending cap", body: "Set the most this request may spend. A cap is permission, not a promise to spend it all." },
  { target: "dispatch-btn", title: "Start research", body: `Submit to see source decisions, payment state, citations, and creator rewards on ${currentArcLabel}.` },
] as const;

export function OnboardingTour() {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [panelHeight, setPanelHeight] = useState(0);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setActive(false);
  }, []);

  useEffect(() => {
    if (!active) return;
    const host = document.createElement("div");
    const triggerElement = trigger.current;
    host.setAttribute("data-keryx-tour-portal", "");
    document.body.appendChild(host);
    const background = Array.from(document.body.children).filter((child) => child !== host && child.tagName !== "SCRIPT");
    const prior = background.map((element) => ({ element, inert: element.hasAttribute("inert"), ariaHidden: element.getAttribute("aria-hidden") }));
    for (const element of background) { element.setAttribute("inert", ""); element.setAttribute("aria-hidden", "true"); }
    const frame = window.requestAnimationFrame(() => setPortalRoot(host));
    return () => {
      window.cancelAnimationFrame(frame);
      for (const { element, inert, ariaHidden } of prior) {
        if (!inert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      host.remove();
      triggerElement?.focus();
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (steps[step].target === "budget") document.dispatchEvent(new CustomEvent("keryx:tour-budget"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const findTarget = () => document.querySelector<HTMLElement>(`[data-tour="${steps[step].target}"]`);
    const scrollTarget = () => {
      const target = findTarget();
      if (!target) return;
      if (window.innerWidth < 640) {
        window.scrollBy({ top: target.getBoundingClientRect().top - 120, behavior: reduced ? "instant" : "smooth" });
      } else {
        target.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "center" });
      }
    };
    const frame = window.requestAnimationFrame(scrollTarget);
    const update = () => {
      setRect(findTarget()?.getBoundingClientRect() ?? null);
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };
    update();
    const timer = window.setTimeout(update, reduced ? 0 : 450);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [active, step]);

  useEffect(() => {
    if (!active || !portalRoot || !panel.current) return;
    const element = panel.current;
    const measure = () => setPanelHeight(element.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [active, portalRoot]);

  useEffect(() => {
    if (!active || !portalRoot) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "Tab" || !panel.current) return;
      const controls = Array.from(panel.current.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [active, close, portalRoot]);

  const narrow = size.width < 640;
  const width = Math.min(340, Math.max(0, size.width - 16));
  const left = rect ? Math.max(8, Math.min(rect.left, size.width - width - 8)) : 8;
  const above = rect ? size.height - rect.bottom < panelHeight + 20 && rect.top > panelHeight + 20 : false;
  const top = rect ? Math.max(8, Math.min(size.height - panelHeight - 8, above ? rect.top - panelHeight - 12 : rect.bottom + 12)) : 8;

  return (
    <>
      <button ref={trigger} type="button" onClick={() => { setStep(0); setActive(true); }} className="inline-flex min-h-11 items-center border border-ink bg-paper px-4 font-mono text-xs text-ink hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-seal">How it works</button>
      {active && portalRoot && createPortal(
        <>
          <div className="fixed inset-0 z-[9998] bg-ink/60" aria-hidden="true" onClick={close} />
          <div ref={panel} role="dialog" aria-modal="true" aria-label="How Keryx works" className="fixed z-[9999] flex max-h-[calc(100dvh-16px)] flex-col overflow-hidden border border-ink bg-paper shadow-xl" style={narrow ? { left: 0, right: 0, bottom: 0, maxHeight: "min(50dvh, 320px)" } : { width, top, left }}>
            <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2"><span className="font-mono text-xs uppercase tracking-wider text-seal">Step {step + 1} of {steps.length}</span><button type="button" onClick={close} aria-label="Close tour" className="min-h-11 min-w-11 text-ink">Close</button></div>
            <div className="min-h-0 overflow-y-auto px-4 py-4"><h2 className="font-display text-lg text-ink">{steps[step].title}</h2><p className="mt-2 font-serif text-sm leading-relaxed text-ink-2">{steps[step].body}</p></div>
            <div className="flex shrink-0 justify-between border-t border-line px-4 py-2"><button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} className="min-h-11 px-3 font-mono text-xs disabled:opacity-40">Back</button><button type="button" onClick={() => step === steps.length - 1 ? close() : setStep(step + 1)} className="min-h-11 border border-ink bg-ink px-4 font-mono text-xs text-paper">{step === steps.length - 1 ? "Done" : "Next"}</button></div>
          </div>
        </>
      , portalRoot)}
    </>
  );
}
