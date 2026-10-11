import { createMessages } from "@/lib/i18n/messages";
import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { McpIntegrationClient } from "./mcp-integration-client";

const uiCopy = createMessages("en");

export const metadata: Metadata = {
  title: uiCopy("mcpSetup.metadataTitle"),
  description:
    uiCopy("mcpSetup.description"),
  alternates: englishPublicAlternates("/integrations/mcp"),
};

export default function McpIntegrationPage() {
  return <McpIntegrationClient />;
}
