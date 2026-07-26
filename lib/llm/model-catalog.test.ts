/**
 * Model catalog invariants: id lookup (bare + "keryx:"-prefixed), unknown → null,
 * ids stay colon-free (colons are reserved for the "keryx:" surface prefix), and
 * the default id exists and is the DeepSeek workhorse.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, findModelChoice, MODEL_CATALOG } from "./model-catalog";

describe("model catalog", () => {
  it("resolves a bare catalog id", () => {
    expect(findModelChoice("deepseek-v4-pro")?.model).toBe("deepseek-v4-pro");
  });

  it('resolves the "keryx:"-prefixed form used on the OpenAI-compatible surface', () => {
    expect(findModelChoice("keryx:deepseek-v4-pro")?.model).toBe("deepseek-v4-pro");
  });

  it("returns null for unknown / empty ids instead of throwing", () => {
    expect(findModelChoice("claude-opus")).toBeNull();
    expect(findModelChoice("")).toBeNull();
    expect(findModelChoice(undefined)).toBeNull();
  });

  it("keeps public ids colon-free and unique", () => {
    const ids = MODEL_CATALOG.map((m) => m.id);
    expect(ids.every((id) => !id.includes(":"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has the DeepSeek workhorse as the default", () => {
    const def = findModelChoice(DEFAULT_MODEL_ID);
    expect(def?.provider).toBe("deepseek");
  });

  /**
   * A public id is a contract: API callers, saved widget embeds and the OpenAI-compatible surface
   * pass these strings. When a provider retires a wire name, the id it was published under must
   * keep resolving — otherwise those callers silently land on the default with no way to tell.
   */
  it("still resolves a retired id, onto its replacement", () => {
    expect(findModelChoice("deepseek-chat")?.id).toBe(DEFAULT_MODEL_ID);
    expect(findModelChoice("keryx:deepseek-chat")?.id).toBe(DEFAULT_MODEL_ID);
  });

  /** The open-weight tier went away with the Ollama Cloud account. Those ids were published, so
   *  they must still answer — a saved widget embed passing `glm-5.2` gets the workhorse, not a 400. */
  it("still resolves every withdrawn open-weight id", () => {
    for (const id of ["glm-5.2", "kimi-k2.7-code", "qwen3.5-397b", "minimax-m3", "gpt-oss-120b", "gemma4"]) {
      expect(findModelChoice(id)?.id, id).toBe(DEFAULT_MODEL_ID);
      expect(findModelChoice(`keryx:${id}`)?.id, id).toBe(DEFAULT_MODEL_ID);
    }
  });

  /** Wire names must be exactly what the provider publishes — a near-miss tag 404s and falls back
   *  to a weaker tier while every log still names the model the asker picked. Both are served by
   *  DeepSeek's own API; `curl https://api.deepseek.com/models` is the check. */
  it("carries the provider's exact wire names", () => {
    expect(findModelChoice(DEFAULT_MODEL_ID)?.model).toBe("deepseek-v4-flash");
    expect(findModelChoice("deepseek-v4-pro")?.model).toBe("deepseek-v4-pro");
  });

  /** Every entry must be reachable with the one DeepSeek key. An entry needing a credential the box
   *  does not have is a picker option that answers only by silently degrading. */
  it("serves every catalog entry from the DeepSeek provider", () => {
    expect(MODEL_CATALOG.every((m) => m.provider === "deepseek")).toBe(true);
  });
});
