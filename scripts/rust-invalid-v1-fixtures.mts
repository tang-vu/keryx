/** Small, deterministic refusal corpus over a TypeScript-written completed v1 directory. */
export const invalidV1Files = [
  { label: "task", file: "task.json", command: "status", versionPath: ["schema"] },
  { label: "request", file: "request.json", command: "status", versionPath: ["packageVersion"] },
  { label: "buyer intent", file: "buyer/intent.json", command: "status", versionPath: ["schema"] },
  { label: "observation", file: "last-observation.json", command: "status", versionPath: ["schema"] },
  { label: "saved result", file: "result.json", command: "result", versionPath: ["schema"] },
  { label: "archived receipt", file: "receipt", command: "result", versionPath: ["payload", "schema"] },
] as const;

export function unsupportedVersion(original: string, path: readonly string[]): string {
  const value: unknown = JSON.parse(original);
  if (!value || typeof value !== "object") throw new Error("Expected a JSON object fixture");
  let object = value as Record<string, unknown>;
  for (const key of path.slice(0, -1)) {
    const nested = object[key];
    if (!nested || typeof nested !== "object") throw new Error(`Missing version parent ${key}`);
    object = nested as Record<string, unknown>;
  }
  const key = path.at(-1);
  if (!key || typeof object[key] !== "string") throw new Error("Missing version field");
  object[key] = "unsupported-v2";
  return JSON.stringify(value);
}

export function truncatedJson(original: string): string {
  const text = original.trimEnd();
  if (!text.endsWith("}")) throw new Error("Expected a JSON object fixture");
  // Delete the closing token, not just the writer's trailing newline.
  return text.slice(0, -1);
}
