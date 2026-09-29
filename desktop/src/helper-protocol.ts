export const MAX_REQUEST_FRAME = 128 * 1024;
export const MAX_RESPONSE_FRAME = 16 * 1024 * 1024;
export const MAX_ERROR_BYTES = 2048;

export type HelperAction = "init" | "choose_workspace" | "create_workspace" | "refresh" |
  "create_task" | "resume_task" | "read_result" | "export_brief" | "export_task" | "import_reference";

export type HelperRequest = { id: number; action: HelperAction; payload: string };
export type HelperResponse = { id: number; ok: true; result: string } | { id: number; ok: false; error: string };

const actions = new Set<HelperAction>(["init", "choose_workspace", "create_workspace", "refresh",
  "create_task", "resume_task", "read_result", "export_brief", "export_task", "import_reference"]);

export function parseRequestFrame(frame: Buffer, priorId: number): HelperRequest {
  if (!frame.length || frame.length > MAX_REQUEST_FRAME || frame.includes(0)) throw new Error("Invalid request frame");
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid request envelope");
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "action,id,payload" || !Number.isSafeInteger(value.id)
    || (value.id as number) !== priorId + 1 || typeof value.action !== "string" || !actions.has(value.action as HelperAction)
    || typeof value.payload !== "string") throw new Error("Invalid request envelope");
  return value as HelperRequest;
}

const errorEncoder = new TextEncoder();
const errorDecoder = new TextDecoder();

// The Rust peer rejects an error string over MAX_ERROR_BYTES UTF-8 bytes after JSON
// decoding, so bound the decoded string — wire escaping does not count toward the limit.
// The encode/decode round trip also replaces lone surrogates, keeping the string valid.
export function boundErrorMessage(message: string): string {
  const bytes = errorEncoder.encode(message);
  if (bytes.length <= MAX_ERROR_BYTES) return errorDecoder.decode(bytes);
  let end = MAX_ERROR_BYTES;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return errorDecoder.decode(bytes.subarray(0, end));
}

export function encodeResponseFrame(response: HelperResponse): Buffer {
  const result = Buffer.from(JSON.stringify(response) + "\n", "utf8");
  if (result.length > MAX_RESPONSE_FRAME) throw new Error("Response exceeds frame limit");
  return result;
}
