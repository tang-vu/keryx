import { OpenAICompatibleEngine } from "../llm/openai-compatible-engine";
import type { ChatJsonOptions } from "../llm/json-chat-engine";
import { ReasoningInputLimitError, ReasoningOutputValidationError, ReasoningTransportError, reasoningOutputTokenLimit } from "../llm/reasoning-engine";
import { configuredBusinessCanary, reserveCanaryModel } from "./canary-policy";

const JSON_INSTRUCTION = " Respond with a single JSON object.";
const MAXIMUM_INPUT_BYTES = 32_000;
const MAXIMUM_OUTPUT_TOKENS = 8192;

/** Fixed official transport. Only the canary policy's opaque admitted context may
 * reserve a supplier call; this engine has no ordinary provider or heuristic tier. */
export class BusinessCanaryEngine extends OpenAICompatibleEngine {
  // chatJson reserves the fixed request through the current opaque admission before super.
  protected assertSupplierAdmission(): void {}
  constructor(apiKey: string) {
    if (!apiKey.trim()) throw new Error("Business canary requires its DeepSeek credential");
    super({ provider: "deepseek", name: "llm:deepseek:deepseek-v4-flash", model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com", apiKey, redirect: "error" });
  }

  protected validateChatJsonInput(_model: string, system: string, user: string, maxTokens = 2048): void {
    const promptUtf8Bytes = Buffer.byteLength(system + JSON_INSTRUCTION + user, "utf8");
    if (promptUtf8Bytes > MAXIMUM_INPUT_BYTES || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAXIMUM_OUTPUT_TOKENS) {
      throw new ReasoningInputLimitError("Business canary request exceeds its supplier bounds", {
        promptUtf8Bytes, requestedOutputTokens: maxTokens, maximumCombinedUnits: MAXIMUM_INPUT_BYTES + MAXIMUM_OUTPUT_TOKENS,
      });
    }
  }

  protected async chatJson(model: string, system: string, user: string, maxTokens = 2048, options?: ChatJsonOptions) {
    this.validateChatJsonInput(model, system, user, maxTokens);
    if (!configuredBusinessCanary()) throw new Error("Business canary supplier policy is unconfigured");
    // Reserve exactly once before HTTP, using the same authored messages whose
    // system suffix is checked above and added by the official transport.
    reserveCanaryModel(system, user, maxTokens);
    try { return await super.chatJson(model, system, user, maxTokens, options); }
    catch (error) { throw redactedCanaryFailure(error); }
  }
}

function redactedCanaryFailure(error: unknown): Error {
  if (error instanceof ReasoningInputLimitError) return error;
  const suppliedStatus = error && typeof error === "object" && "status" in error ? error.status : undefined;
  const status = typeof suppliedStatus === "number" && Number.isInteger(suppliedStatus) && suppliedStatus >= 100 && suppliedStatus <= 599
    ? suppliedStatus : undefined;
  const retained = `${status ? ` (${status})` : ""}; reservation retained`;
  if (error instanceof ReasoningOutputValidationError)
    return Object.assign(new ReasoningOutputValidationError(`Business canary output failed validation${retained}`, reasoningOutputTokenLimit(error)), { status });
  if (error instanceof ReasoningTransportError) {
    const failure = new ReasoningTransportError(error.category);
    failure.message = `Business canary provider request failed (${error.category}); reservation retained`;
    return failure;
  }
  return Object.assign(new Error(`Business canary provider request failed${retained}`), { status });
}
