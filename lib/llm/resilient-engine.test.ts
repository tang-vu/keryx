/**
 * Resilience must never cost honesty. A run that fell back has to be labelled by the engine that
 * actually answered it — the failure this pins down is a real one: a retired model id upstream had
 * every reasoning step dropping to the heuristic while each run was still stamped `llm:deepseek:…`
 * on its permalink, in the archive and in the API response, for days, with nothing saying so.
 */

import { describe, expect, it, vi } from "vitest";
import { ResilientEngine, effectiveEngineName } from "./resilient-engine";
import type { ReasoningEngine } from "./reasoning-engine";

/** An engine whose every call rejects with the given status (undefined = network error). */
function brokenEngine(name: string, status?: number): ReasoningEngine {
  const err = Object.assign(new Error(`LLM ${status ?? "network"}`), { status });
  return {
    name,
    decompose: () => Promise.reject(err),
    decide: () => Promise.reject(err),
    sufficiency: () => Promise.reject(err),
    reevaluate: () => Promise.reject(err),
    synthesize: () => Promise.reject(err),
    attribute: () => Promise.reject(err),
  } as unknown as ReasoningEngine;
}

function workingEngine(name: string): ReasoningEngine {
  return {
    name,
    decompose: () => Promise.resolve(["claim"]),
    decide: () => Promise.resolve([]),
    sufficiency: () => Promise.resolve({ sufficient: true, rationale: "" }),
    reevaluate: () => Promise.resolve({ buyMore: [], rationale: "" }),
    synthesize: () => Promise.resolve({ answer: "a", markers: [] }),
    attribute: () => Promise.resolve([]),
  } as unknown as ReasoningEngine;
}

describe("ResilientEngine labelling", () => {
  it("keeps the pick's name when the pick answers", async () => {
    const e = new ResilientEngine(workingEngine("llm:deepseek:deepseek-v4-flash"));
    await e.decompose("q");
    expect(e.effectiveName).toBe("llm:deepseek:deepseek-v4-flash");
  });

  it("names the heuristic when nothing the pick produced survived", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = new ResilientEngine(brokenEngine("llm:deepseek:deepseek-chat", 400));
    await e.decompose("q");
    // Real fallback: the heuristic engine actually runs, so the input must be a real one.
    await e.synthesize({ question: "q", subClaims: [], gathered: [] });
    expect(e.effectiveName).toBe("heuristic (fallback from llm:deepseek:deepseek-chat)");
  });

  it("says how many steps fell back when the pick answered some of them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const flaky = {
      ...workingEngine("llm:ollama:glm-5.2"),
      decompose: () => (++calls === 1 ? Promise.resolve(["ok"]) : Promise.reject(hardError())),
    } as unknown as ReasoningEngine;
    const e = new ResilientEngine(flaky);
    await e.decompose("q"); // served by the pick
    await e.decompose("q"); // falls back
    expect(e.effectiveName).toBe("llm:ollama:glm-5.2 + heuristic on 1 step");
  });

  /** Ollama picks fall back to DeepSeek, which falls back to the heuristic. A run served by the
   *  middle tier must name that tier — not the pick above it, and not the heuristic below. */
  it("reports the tier that answered in a chained fallback", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deepseek = new ResilientEngine(workingEngine("llm:deepseek:deepseek-v4-flash"));
    const e = new ResilientEngine(brokenEngine("llm:ollama:gemma4", 404), deepseek);
    await e.decompose("q");
    expect(e.effectiveName).toBe(
      "llm:deepseek:deepseek-v4-flash (fallback from llm:ollama:gemma4)",
    );
  });

  it("retries a transient failure before giving up on the pick", async () => {
    let attempts = 0;
    const flaky = {
      ...workingEngine("llm:deepseek:deepseek-v4-flash"),
      decompose: () =>
        ++attempts < 3
          ? Promise.reject(Object.assign(new Error("LLM 429"), { status: 429 }))
          : Promise.resolve(["ok"]),
    } as unknown as ReasoningEngine;
    const e = new ResilientEngine(flaky);
    expect(await e.decompose("q")).toEqual(["ok"]);
    expect(attempts).toBe(3);
    expect(e.effectiveName).toBe("llm:deepseek:deepseek-v4-flash"); // never fell back
  });

  it("reads a plain engine's name straight through", () => {
    expect(effectiveEngineName(workingEngine("heuristic"))).toBe("heuristic");
  });
});

/** A non-transient error: retrying a 400 would just burn the same wall clock three times. */
function hardError(): Error {
  return Object.assign(new Error("LLM 400"), { status: 400 });
}
