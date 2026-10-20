import { describe, expect, it } from "vitest";
import { buildEvidenceDraft, evidenceDraftRequestSchema, MAX_EVIDENCE_DRAFT_BYTES } from "./evidence-draft";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { MAX_EVIDENCE_DRAFT_BACKUP_BYTES, prepareEvidenceDraftRestore } from "./evidence-draft-restore";

describe("private evidence draft backup restore", () => {
  it("restores the existing downloaded JSON format with exact excerpt and assessment bindings", () => {
    const packet = evidenceDraftFixture(), excerpt = buildEvidenceDraft(packet).excerpts[0];
    packet.claims[0].excerptIds = [excerpt.id];
    packet.claims[0].assessment = { origin: "user-assessment", reviewer: "Fixture reviewer", reviewedAt: "2026-10-20T00:00:00Z",
      verdict: "supported", claimText: packet.passage, paperUrls: packet.claims[0].paperUrls, excerptIds: [excerpt.id], excerpts: [excerpt] };
    packet.themes[0].excerptIds = [excerpt.id];
    const before = JSON.stringify(packet), restored = prepareEvidenceDraftRestore(JSON.stringify(packet, null, 2) + "\n");
    expect(restored.request).toEqual(packet);
    expect(buildEvidenceDraft(restored.request)).toEqual(buildEvidenceDraft(packet));
    expect(restored.summary).toMatchObject({ title: "Methods review", papers: 1, reports: 1, excerpts: 1, claims: 1, themes: 1 });
    expect(JSON.stringify(packet)).toBe(before);
  });

  it("does not replay assembly or turn bibliography notes into evidence", () => {
    const packet = evidenceDraftFixture();
    packet.assembly = { mode: "append" };
    packet.workspace.entries[0].notes = "A private screening note, not evidence";
    const restored = prepareEvidenceDraftRestore(JSON.stringify(packet));
    expect(restored.request).not.toHaveProperty("assembly");
    expect(restored.request.themes).toEqual(packet.themes);
    expect(restored.request.workspace.entries[0].notes).toBe("");
    expect(restored.summary.themes).toBe(1);
  });

  it("allows indentation and whitespace while retaining the compact draft limit", () => {
    const raw = " ".repeat(MAX_EVIDENCE_DRAFT_BYTES) + JSON.stringify(evidenceDraftFixture(), null, 2);
    expect(prepareEvidenceDraftRestore(raw).summary.reports).toBe(1);
    expect(() => prepareEvidenceDraftRestore(" ".repeat(MAX_EVIDENCE_DRAFT_BACKUP_BYTES + 1))).toThrow();
    const large = evidenceDraftFixture();
    large.claims = [];
    large.passage = "p".repeat(12000);
    large.themes = Array.from({ length: 16 }, (_, index) => ({ id: `theme${index}`, title: "Topic", authorNote: "n".repeat(2000), excerptIds: [] }));
    large.workspace.entries[0].paper.authors = Array.from({ length: 50 }, () => "a".repeat(300));
    large.workspace.entries[0].paper.authorCount = 50;
    large.workspace.entries[0].paper.authorsTruncated = false;
    large.reports = Array.from({ length: 8 }, (_, index) => ({ ...large.reports[0], id: `report${index}`,
      subClaims: ["s".repeat(4000)] }));
    expect(evidenceDraftRequestSchema.safeParse(large).success).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(large)).byteLength).toBeGreaterThan(MAX_EVIDENCE_DRAFT_BYTES);
    expect(() => prepareEvidenceDraftRestore(JSON.stringify(large))).toThrow();
  });

  it("refuses malformed, unrelated, duplicate and broken exact selections", () => {
    expect(() => prepareEvidenceDraftRestore("{broken")).toThrow();
    expect(() => prepareEvidenceDraftRestore(JSON.stringify({ version: 1, scope: "personal-bibliography" }))).toThrow();
    const duplicate = evidenceDraftFixture(); duplicate.reports.push(duplicate.reports[0]);
    expect(() => prepareEvidenceDraftRestore(JSON.stringify(duplicate))).toThrow();
    const missing = evidenceDraftFixture(); missing.themes[0].excerptIds = ["missing"];
    expect(() => prepareEvidenceDraftRestore(JSON.stringify(missing))).toThrow();
    const split = evidenceDraftFixture(); split.passage = "😀"; split.claims[0].start = 0; split.claims[0].end = 1;
    expect(() => prepareEvidenceDraftRestore(JSON.stringify(split))).toThrow();
  });

  it("keeps stale assessments stale instead of promoting them during restore", () => {
    const packet = evidenceDraftFixture(), excerpt = buildEvidenceDraft(packet).excerpts[0];
    packet.claims[0].excerptIds = [excerpt.id];
    packet.claims[0].assessment = { origin: "user-assessment", reviewer: "Fixture reviewer", reviewedAt: "2026-10-20T00:00:00Z",
      verdict: "supported", claimText: "Different original claim", paperUrls: packet.claims[0].paperUrls, excerptIds: [excerpt.id], excerpts: [excerpt] };
    const claim = buildEvidenceDraft(prepareEvidenceDraftRestore(JSON.stringify(packet)).request).claims[0];
    expect(claim.status).toBe("assessment-pending");
    expect(claim.assessmentStale).toBe(true);
    expect(claim).not.toHaveProperty("assessment");
  });
});
