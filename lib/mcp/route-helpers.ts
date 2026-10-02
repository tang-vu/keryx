import { NextRequest } from "next/server";
import { config } from "../config";
import type { McpClientChannel } from "../types";

function configuredOrigins(req: NextRequest): Set<string> {
  const values = [
    req.nextUrl.origin,
    config.baseUrl,
    ...(process.env.KERYX_MCP_ALLOWED_ORIGINS ?? "").split(","),
  ];
  return new Set(
    values.flatMap((value) => {
      try {
        return value.trim() ? [new URL(value.trim()).origin] : [];
      } catch {
        return [];
      }
    }),
  );
}

export function isAllowedMcpOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  return !origin || configuredOrigins(req).has(origin);
}

export function researchCallCount(body: unknown): number {
  const pending = [body];
  let count = 0;
  while (pending.length) {
    const item = pending.pop();
    if (Array.isArray(item)) { for (const child of item) pending.push(child); continue; }
    if (!item || typeof item !== "object") continue;
    const message = item as { method?: unknown; params?: { name?: unknown } };
    if (message.method === "tools/call" && message.params?.name === "research") count++;
  }
  return count;
}

export function normalizeMcpClient(value: string | null): McpClientChannel {
  if (!value) return "direct";
  const normalized = value.trim().toLowerCase();
  if (normalized === "codex" || normalized === "claude" || normalized === "cursor") {
    return normalized;
  }
  return "other";
}
