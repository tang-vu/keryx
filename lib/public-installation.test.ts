import { describe, expect, it } from "vitest";
import application from "../package.json";
import operator from "../desktop/package.json";
import mcp from "../mcp/package.json";
import { installationLinks, setupExamples } from "./public-installation";
import { setupCopy } from "../locales/en/get-started";
import { previewText } from "./i18n/ui-preview";
import viPreview from "../locales/generated/vi-ui-preview";
import zhPreview from "../locales/generated/zh-Hans-ui-preview";

describe("published installation selectors follow their own canonical release roles", () => {
  it("selects the application release for all Operator asset entry points", () => {
    const release = `https://github.com/tang-vu/keryx/releases/tag/v${application.version}`;
    for (const key of ["release", "installer", "portable", "checksums", "manifest"] as const)
      expect(installationLinks[key], key).toBe(release);
  });

  it("uses the stdio MCP package name and version, with the existing npx workflow", () => {
    expect(JSON.parse(setupExamples.stdio)).toEqual({
      mcpServers: { keryx: { command: "npx", args: ["-y", `${mcp.name}@${mcp.version}`] } },
    });
  });

  it("labels Operator with its desktop version and the containing application release", () => {
    expect(setupCopy.download.desktopVersion).toBe(`Operator ${operator.version} · release v${application.version}`);
  });

  for (const [locale, preview] of [["vi", viPreview], ["zh-Hans", zhPreview]] as const)
    it(`${locale} preview never restores a stale numeric Operator/release label`, () => {
      const label = previewText(preview, setupCopy.download.desktopVersion, ["get-started"]);
      expect(label).toContain(`Operator ${operator.version}`);
      expect(label).toContain(`v${application.version}`);
    });
});
