import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parseSponsoredArgs, runSponsoredCli } from "./ask-sponsored.mts";
import { researchSponsored, SponsoredResearchError, type SponsoredResearchResult } from "../shared/sponsored-research-client.ts";

const id = "12345678-1234-4123-8123-123456789abc";
const result: SponsoredResearchResult = { answer: "A grounded answer", queryId: id, dispatchUrl: `https://keryx.cc/dispatch/${id}`,
  citations: [{ sourceName: "Source", sourceUrl: "https://evidence.example/article", rewardPlannedUsdc: 0.01 }], creatorsPaid: null,
  researchExports: { bibtex: "@article{a}" } };
const script = fileURLToPath(new URL("./ask-sponsored.mts", import.meta.url));

function io() { return { stdout: vi.fn<(text: string) => void>(), stderr: vi.fn<(text: string) => void>() }; }

describe("sponsored CLI", () => {
  it("prints help without invoking the client", async () => {
    const output = io(), client = vi.fn<typeof researchSponsored>();
    expect(await runSponsoredCli(["--help"], { ...output, client })).toBe(0);
    expect(output.stdout).toHaveBeenCalledWith(expect.stringContaining('npm run ask:sponsored -- --public "question"'));
    expect(output.stderr).not.toHaveBeenCalled();
    expect(client).not.toHaveBeenCalled();
  });

  it("requires explicit public consent before invoking any client", async () => {
    const output = io(), client = vi.fn<typeof researchSponsored>();
    expect(await runSponsoredCli(["a question"], { ...output, client })).toBe(1);
    expect(output.stderr).toHaveBeenCalledWith(expect.stringContaining("--public is required"));
    expect(client).not.toHaveBeenCalled();
  });

  it("parses public question, zero budget, mode and loopback base URL and prints the complete result", async () => {
    const output = io();
    const client = vi.fn<typeof researchSponsored>(async (_input, options) => { options?.onProgress?.("[discover] one source\n"); return result; });
    const signal = new AbortController().signal;
    expect(await runSponsoredCli(["--public", "Compare", "sources", "--budget", "0", "--mode", "quick", "--base-url", "http://127.0.0.1:3939"],
      { ...output, client, signal })).toBe(0);
    expect(client).toHaveBeenCalledExactlyOnceWith({ question: "Compare sources", budget: 0, mode: "quick", publicReport: true },
      { baseUrl: "http://127.0.0.1:3939", signal, onProgress: expect.any(Function) });
    expect(output.stderr).toHaveBeenCalledWith("[discover] one source\n");
    expect(JSON.parse(output.stdout.mock.calls[0][0])).toEqual(result);
  });

  it("preserves HTTP, terminal and uncertainty diagnostics as a failing exit status", async () => {
    const output = io(), client = vi.fn<typeof researchSponsored>().mockRejectedValue(new SponsoredResearchError("Capacity full.", {
      code: "sponsored_rate_limit", status: 429, retryAfter: "60", uncertain: false, queryId: id, dispatchUrl: result.dispatchUrl,
    }));
    expect(await runSponsoredCli(["--public", "question"], { ...output, client })).toBe(1);
    expect(client).toHaveBeenCalledTimes(1);
    expect(output.stdout).not.toHaveBeenCalled();
    expect(JSON.parse(output.stderr.mock.calls.at(-1)![0])).toMatchObject({ error: "Capacity full.", status: 429, code: "sponsored_rate_limit",
      retryAfter: "60", uncertain: false, queryId: id, dispatchUrl: result.dispatchUrl });
  });

  it("exercises the shared HTTP error parser through the injected CLI client", async () => {
    const output = io(), fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ error: { message: "Paused", code: "research_paused" } },
      { status: 503, headers: { "Retry-After": "120" } }));
    const client: typeof researchSponsored = (input, options) => researchSponsored(input, { ...options, fetch });
    expect(await runSponsoredCli(["--public", "question"], { ...output, client })).toBe(1);
    expect(JSON.parse(output.stderr.mock.calls.at(-1)![0])).toMatchObject({ status: 503, retryAfter: "120", code: "research_paused", uncertain: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("parses a real successful SSE response through the CLI without a live request", async () => {
    const output = io();
    const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    const wire = event({ id: `chatcmpl-${id}`, choices: [{ delta: { content: result.answer }, finish_reason: null }] }) +
      event({ id: `chatcmpl-${id}`, choices: [{ delta: {}, finish_reason: "stop" }], keryx: result, keryx_private: { ticket: "PRIVATE" } }) + "data: [DONE]\n\n";
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(wire, { headers: { "Content-Type": "text/event-stream" } }));
    const client: typeof researchSponsored = (input, options) => researchSponsored(input, { ...options, fetch });
    expect(await runSponsoredCli(["--public", "question", "--budget", "0"], { ...output, client })).toBe(0);
    expect(JSON.parse(output.stdout.mock.calls[0][0])).toEqual(result);
    expect(output.stdout.mock.calls[0][0]).not.toContain("PRIVATE");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["--public"], ["--public", " "], ["--public", "q".repeat(2001)],
    ["--public", "q", "--budget", "NaN"], ["--public", "q", "--budget", "Infinity"],
    ["--public", "q", "--budget", "-1"], ["--public", "q", "--budget", "0.081"], ["--public", "q", "--budget"],
    ["--public", "q", "--budget", "0", "--budget", "0.01"], ["--public", "q", "--mode", "unknown"],
    ["--public", "q", "--base-url", "https://keryx.cc/api/v1"], ["--public", "q", "--base-url", "http://evil.example"],
    ["--public", "q", "--api-key", "secret"], ["--public", "q", "--unknown"],
  ].map(args => ({ args })))("rejects malformed arguments without invoking the injected client: %j", async ({ args }) => {
    const output = io(), client = vi.fn<typeof researchSponsored>();
    expect(await runSponsoredCli(args, { ...output, client })).toBe(1);
    expect(client).not.toHaveBeenCalled();
    expect(output.stdout).not.toHaveBeenCalled();
  });

  it("preserves API defaults and allows an explicit positional separator", () => {
    expect(parseSponsoredArgs(["--public", "--", "--not-an-option question"])).toEqual({ input: {
      question: "--not-an-option question", mode: "deep", budget: 0.05, publicReport: true,
    }, baseUrl: "https://keryx.cc" });
  });

  it("launches real help with no credentials or network", () => {
    const stdout = execFileSync(process.execPath, ["--import", "tsx", script, "--help"], { encoding: "utf8", timeout: 15_000 });
    expect(stdout).toContain("No API key, wallet, or environment file is needed.");
    expect(stdout).toContain('npm run ask:sponsored -- --public "question"');
  });

  it("launches the real missing-public path and exits before any network request", () => {
    try {
      execFileSync(process.execPath, ["--import", "tsx", script, "question without consent"], { encoding: "utf8", timeout: 15_000, stdio: "pipe" });
      throw new Error("Expected a failing exit status");
    } catch (error) {
      expect(error).toMatchObject({ status: 1, stdout: "" });
      expect(String((error as { stderr?: string }).stderr)).toContain("--public is required");
    }
  });
});
