import type { Metadata } from "next";
import { McpIntegrationClient } from "./mcp-integration-client";

export const metadata: Metadata = {
  title: "Remote MCP setup",
  description:
    "Connect Codex, Claude Code, or Cursor to Keryx research and pay cited creators in Arc USDC.",
  alternates: { canonical: "/integrations/mcp" },
};

export default function McpIntegrationPage() {
  return <McpIntegrationClient />;
}
