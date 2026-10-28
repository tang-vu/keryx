// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InkBleedCursor } from "@/components/keryx/ink-bleed-cursor";

let root: Root, container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>, frameId: number, now: number;
let hidden: boolean, fine: boolean, reduced: boolean, inkVisible: boolean;
const clear = vi.fn(() => { inkVisible = false; });
const fill = vi.fn(() => { inkVisible = true; });
const context = {
  clearRect: clear, fill, setTransform: vi.fn(), beginPath: vi.fn(), arc: vi.fn(),
  createRadialGradient: () => ({ addColorStop: vi.fn() }),
};
const move = (x: number, y = 100) => window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y }));
const visibility = (value: boolean) => {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
};
const tick = (ms = 1000 / 60) => {
  now += ms;
  const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback(now);
};
const mount = async () => { await act(async () => { root.render(createElement(InkBleedCursor)); }); };

beforeEach(() => {
  frames = new Map(); frameId = 0; now = 0; hidden = false; fine = true; reduced = false; inkVisible = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = frameId++; frames.set(id, callback); return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { frames.delete(id); }));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduced-motion") ? reduced : fine }));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); }); container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

describe("cursor animation work", () => {
  it("does no frame work before a pointer stroke, including sub-threshold movement", async () => {
    await mount(); move(100); move(101);
    for (let i = 0; i < 120; i++) tick();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(fill).not.toHaveBeenCalled();
  });

  it.each([60, 144])("dries every blot, clears the final pixels, and idles at %i Hz", async hz => {
    await mount(); move(100); move(120); move(140);
    expect(frames.size).toBe(1);
    tick(1000 / hz); expect(fill).toHaveBeenCalled(); expect(inkVisible).toBe(true);
    for (let i = 0; i < hz * 3 && frames.size; i++) tick(1000 / hz);
    expect(frames.size).toBe(0); expect(inkVisible).toBe(false);
    const calls = clear.mock.calls.length;
    for (let i = 0; i < hz; i++) tick(1000 / hz);
    expect(clear).toHaveBeenCalledTimes(calls);
    move(160); expect(frames.size).toBe(1); tick(1000 / hz); expect(inkVisible).toBe(true);
  });

  it("keeps one frame pending during rapid movement and repeated visibility events", async () => {
    await mount();
    for (let x = 100; x < 500; x += 10) move(x);
    visibility(false); visibility(false);
    expect(frames.size).toBe(1);
    tick(); expect(frames.size).toBe(1);
  });

  it("pauses live ink while hidden and resumes it once when visible", async () => {
    await mount(); move(100); move(120); tick();
    visibility(true); expect(frames.size).toBe(0);
    const calls = fill.mock.calls.length;
    move(500); tick(5000); expect(fill).toHaveBeenCalledTimes(calls);
    visibility(false); visibility(false); expect(frames.size).toBe(1);
    tick(); expect(fill.mock.calls.length).toBeGreaterThan(calls);
  });

  it("does not start work for an initially hidden page or empty visibility resumes", async () => {
    hidden = true; await mount(); move(100); move(120); tick();
    expect(frames.size).toBe(0); expect(clear).not.toHaveBeenCalled();
    visibility(false); visibility(false); expect(frames.size).toBe(0);
    move(140); move(160); expect(frames.size).toBe(1);
  });

  it.each(["coarse", "reduced"])("keeps the %s pointer preference free of canvas work", async preference => {
    fine = preference !== "coarse"; reduced = preference === "reduced";
    await mount(); move(100); move(120); visibility(false); tick();
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled(); expect(frames.size).toBe(0);
  });

  it("cancels even frame ID zero and removes listeners on unmount", async () => {
    await mount(); move(100); move(120); expect(frames.has(0)).toBe(true);
    await act(async () => { root.unmount(); }); root = createRoot(container);
    expect(frames.size).toBe(0);
    move(200); visibility(false); window.dispatchEvent(new Event("resize"));
    expect(frames.size).toBe(0);
  });
});
