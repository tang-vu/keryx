import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/** Local correlation only: no provider identifiers, prompts or response bodies. */
export interface LlmCallRecord {
  id: string;
  engine: string;
  outcome: "pending" | "returned" | "failed";
}

export class LlmCallLedger {
  private readonly context = new AsyncLocalStorage<string>();
  private readonly records: LlmCallRecord[] = [];

  get currentId(): string | undefined { return this.context.getStore(); }
  get calls(): LlmCallRecord[] { return this.records.map((record) => ({ ...record })); }

  async track<T>(engine: string, call: () => Promise<T>): Promise<T> {
    const record: LlmCallRecord = { id: randomUUID(), engine, outcome: "pending" };
    this.records.push(record);
    return this.context.run(record.id, async () => {
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
