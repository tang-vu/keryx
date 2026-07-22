/**
 * Model catalog invariants: id lookup (bare + "keryx:"-prefixed), unknown → null,
 * ids stay colon-free (colons are reserved for the "keryx:" surface prefix), and
 * the default id exists and is the DeepSeek workhorse.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, findModelChoice, MODEL_CATALOG } from "./model-catalog";

describe("model catalog", () => {
  it("resolves a bare catalog id", () => {
    expect(findModelChoice("glm-5.2")?.model).toBe("glm-5.2");
  });

  it('resolves the "keryx:"-prefixed form used on the OpenAI-compatible surface', () => {
    expect(findModelChoice("keryx:gpt-oss-120b")?.model).toBe("gpt-oss:120b");
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
});
