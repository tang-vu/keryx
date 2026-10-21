import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { LlmCallStage } from "./reasoning-engine";

/** Local correlation only: no provider identifiers, prompts or response bodies. */
export interface LlmCallRecord {
  id: string;
  engine: string;
  outcome: "pending" | "returned" | "failed";
  stage?: LlmCallStage;
}

export class LlmCallLedger {
  private readonly context = new AsyncLocalStorage<LlmCallRecord>();
  private readonly records: LlmCallRecord[] = [];

  get currentId(): string | undefined { return this.context.getStore()?.id; }
  get currentStage(): LlmCallStage | undefined { return this.context.getStore()?.stage; }
  get calls(): LlmCallRecord[] { return this.records.map((record) => ({ ...record })); }

  async track<T>(engine: string, call: () => Promise<T>, stage?: LlmCallStage): Promise<T> {
    const record: LlmCallRecord = { id: randomUUID(), engine, outcome: "pending", ...(stage ? { stage } : {}) };
    this.records.push(record);
    return this.context.run(record, async () => {
      try {
        const result = await call();
        record.outcome = "returned";
        return result;
      } catch (error) {
        record.outcome = "failed";
        throw error;
      }
    });
  }
}
