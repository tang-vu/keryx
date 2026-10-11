import { createMessages } from "@/lib/i18n/messages";
import type { Metadata } from "next";
import { McpIntegrationClient } from "./mcp-integration-client";

const uiCopy = createMessages("en");

export const metadata: Metadata = {
  title: uiCopy("mcpSetup.metadataTitle"),
  description:
    uiCopy("mcpSetup.description"),
  alternates: { canonical: "/integrations/mcp" },
};

export default function McpIntegrationPage() {
  return <McpIntegrationClient />;
}
