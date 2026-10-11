import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { McpIntegrationClient } from "./mcp-integration-client";

export const metadata: Metadata = {
  title: "Remote MCP setup",
  description:
    "Connect Codex, Claude Code, or Cursor to Keryx research and pay cited creators in Arc USDC.",
  alternates: englishPublicAlternates("/integrations/mcp"),
};

export default function McpIntegrationPage() {
  return <McpIntegrationClient />;
}
