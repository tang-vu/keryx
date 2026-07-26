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
   *  to a weaker tier while every log still names the model the asker picked. Verified against each
   *  provider's own list: `curl https://api.deepseek.com/models`,
   *  `curl https://api.xiaomimimo.com/v1/models`. */
  it("carries each provider's exact wire names", () => {
    expect(findModelChoice(DEFAULT_MODEL_ID)?.model).toBe("deepseek-v4-flash");
    expect(findModelChoice("deepseek-v4-pro")?.model).toBe("deepseek-v4-pro");
    expect(findModelChoice("mimo-v2.5")?.model).toBe("mimo-v2.5");
    expect(findModelChoice("mimo-v2.5-pro")?.model).toBe("mimo-v2.5-pro");
  });

  /** Every entry must name a provider `provider-endpoints.ts` can resolve. An entry pointing at a
   *  provider nothing knows how to reach is a picker option that answers only by degrading. */
  it("names a known provider on every entry", () => {
    const known = new Set(["deepseek", "mimo"]);
    expect(MODEL_CATALOG.every((m) => known.has(m.provider))).toBe(true);
  });

  /** The default is the tier every other pick falls back onto, so it must never be the one whose
   *  credential is optional. */
  it("keeps the default on the provider the box is built around", () => {
    expect(findModelChoice(DEFAULT_MODEL_ID)?.provider).toBe("deepseek");
  });
});
