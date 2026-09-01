import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryRun } from "../types";

const mocks = vi.hoisted(() => ({ runAgent: vi.fn() }));

vi.mock("./run-agent", () => ({ runAgent: mocks.runAgent }));

import { collectRun } from "./index";

const run = {
  id: "a2a_test",
  answer: "answer",
  citations: [],
  evidence: [],
  claimCoverage: [],
  totalToCreators: 0,
  engine: "test",
  paymentMode: "real",
} as QueryRun;

describe("collectRun persistence boundary", () => {
  beforeEach(() => {
    mocks.runAgent.mockReset();
    mocks.runAgent.mockImplementation(async function* () {
      return run;
    });
  });

  it("awaits the trusted boundary before saving the QueryRun", async () => {
    const sequence: string[] = [];
    const deps = {
      db: {
        saveQueryRun: vi.fn(async () => {
          sequence.push("save");
        }),
      },
    };
    const result = await collectRun(
      {
        question: "q",
        budget: 0.01,
        onQueryRunSaveBoundary: async () => {
          sequence.push("boundary");
        },
      },
      { deps: deps as never },
    );
    expect(result).toBe(run);
    expect(sequence).toEqual(["boundary", "save"]);
  });

  it("does not save when the durable boundary cannot be crossed", async () => {
    const saveQueryRun = vi.fn();
    await expect(
      collectRun(
        {
          question: "q",
          budget: 0.01,
          onQueryRunSaveBoundary: async () => {
            throw new Error("order already closed");
          },
        },
        { deps: { db: { saveQueryRun } } as never },
      ),
    ).rejects.toThrow("order already closed");
    expect(saveQueryRun).not.toHaveBeenCalled();
  });
});
