import fs from "node:fs";
import { OpenAICompatibleEngine } from "../llm/openai-compatible-engine";

// Official Flash peak tariffs rechecked 2026-10-04. This is a dated evaluation
// allowance, not an invoice reconciliation or a general-purpose billing service.
// https://api-docs.deepseek.com/quick_start/pricing/
const PRICE_DATE = "2026-10-04";
const MAX_MICRO_USD = 1_000_000;
interface BudgetState { priceDate: string; reservedMicroUsd: number; calls: number; createdAt: string; halted?: boolean }

/** One durable, nonrefundable reserve for the entire batch, including failed HTTP calls. */
export class WorkloadModelBudget {
  private state: BudgetState;
  private readonly lockFile: string;
  private closed = false;
  constructor(private readonly file: string) {
    if (new Date().toISOString().slice(0, 10) !== PRICE_DATE) throw new Error("Revalidate workload pricing and authorization before live execution");
    this.lockFile = `${file}.lock`;
    // An interrupted process leaves the lock held. Recover it only after inspecting
    // retained state and proving no original process can still issue a call.
    fs.writeFileSync(this.lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), { flag: "wx", flush: true });
    if (fs.existsSync(file)) {
      this.state = JSON.parse(fs.readFileSync(file, "utf8")) as BudgetState;
      if (this.state.priceDate !== PRICE_DATE || !Number.isSafeInteger(this.state.calls) || this.state.calls < 0 ||
        !Number.isSafeInteger(this.state.reservedMicroUsd) || this.state.reservedMicroUsd < 0 || this.state.reservedMicroUsd > MAX_MICRO_USD)
        throw new Error("Invalid retained workload allowance");
    } else {
      this.state = { priceDate: PRICE_DATE, reservedMicroUsd: 0, calls: 0, createdAt: new Date().toISOString() };
      fs.writeFileSync(file, JSON.stringify(this.state), { flag: "wx", flush: true });
    }
  }
  reserve(system: string, user: string, maxTokens: number): void {
    if (this.closed) throw new Error("Workload allowance is closed");
    if (this.state.halted) throw new Error("Workload provider calls halted after authorization or quota error");
    // One token per UTF-8 byte, plus 4096 framing tokens, bounds these plain text
    // prompts conservatively. Never refund missing/failed provider usage counters.
    const inputBound = Buffer.byteLength(system + " Respond with a single JSON object." + user, "utf8") + 4096;
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192 || inputBound > 200_000) throw new Error("Workload request bound exceeded");
    const reserve = Math.ceil(inputBound * 0.3 + maxTokens * 1.2);
    if (this.state.calls >= 180 || this.state.reservedMicroUsd + reserve > MAX_MICRO_USD) throw new Error("Workload model allowance exhausted");
    this.state.calls++;
    this.state.reservedMicroUsd += reserve;
    fs.writeFileSync(this.file, JSON.stringify(this.state), { flush: true });
  }
  snapshot() { return { ...this.state, ceilingMicroUsd: MAX_MICRO_USD, authority: "conservative-reservation-not-invoice" }; }
  halt() { this.state.halted = true; fs.writeFileSync(this.file, JSON.stringify(this.state), { flush: true }); }
  close() { if (!this.closed) { this.closed = true; fs.unlinkSync(this.lockFile); } }
}

export class BoundedWorkloadEngine extends OpenAICompatibleEngine {
  constructor(apiKey: string, private readonly allowance: WorkloadModelBudget) {
    super({ provider: "deepseek", name: "llm:deepseek:deepseek-v4-flash", model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com", apiKey, redirect: "error" });
  }
  protected async chatJson(model: string, system: string, user: string, maxTokens = 2048) {
    this.allowance.reserve(system, user, maxTokens);
    // No retries, catalog fallback, provider search or payment tools.
    try { return await super.chatJson(model, system, user, maxTokens); }
    catch (error) {
      const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
      if (status && [401, 402, 403, 429].includes(status)) this.allowance.halt();
      throw Object.assign(new Error(`Workload provider request failed${status ? ` (${status})` : ""}`), { status });
    }
  }
}
