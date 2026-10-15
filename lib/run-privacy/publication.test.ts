import { describe, expect, it } from "vitest";
import { PublicationError, researchPublication } from "./publication";

const context = { privacyActive: true, hasOwner: true };
describe("ordinary research publication at creation", () => {
  it("defaults to public for both signed-in and anonymous callers", () => {
    expect(researchPublication(context)).toBe("public");
    expect(researchPublication({ ...context, hasOwner: false })).toBe("public");
  });
  it.each(["private", "unlisted", "public"] as const)("honors the saved %s account preference", defaultVisibility => {
    expect(researchPublication({ ...context, defaultVisibility })).toBe(defaultVisibility);
  });
  it("lets the creator deliberately override their default for this new question", () => {
    expect(researchPublication({ ...context, defaultVisibility: "private", requested: "public" })).toBe("public");
  });
  it.each([null, "", "PUBLIC", {}, 0, false])("refuses malformed explicit visibility %j", requested => {
    expect(() => researchPublication({ ...context, requested })).toThrow(PublicationError);
  });
  it("requires an owner for private access while allowing anonymous unlisted links", () => {
    expect(() => researchPublication({ ...context, hasOwner: false, requested: "private" })).toThrow("Sign in");
    expect(researchPublication({ ...context, hasOwner: false, requested: "unlisted" })).toBe("unlisted");
  });
  it.each(["private", "unlisted"] as const)("inherits hidden %s parent context instead of silently publishing it", parentVisibility => {
    expect(researchPublication({ ...context, parentVisibility })).toBe(parentVisibility);
    expect(() => researchPublication({ ...context, parentVisibility, requested: "public" })).toThrow("hidden question");
  });
  it("does not downgrade private parent context to an unlisted share link", () => {
    expect(() => researchPublication({ ...context, parentVisibility: "private", requested: "unlisted" })).toThrow("hidden question");
    expect(researchPublication({ ...context, parentVisibility: "unlisted", requested: "private" })).toBe("private");
  });
  it("refuses hidden asks before submission when privacy storage is inactive", () => {
    expect(() => researchPublication({ ...context, privacyActive: false, requested: "private" })).toThrow("temporarily unavailable");
    expect(() => researchPublication({ ...context, privacyActive: false, requested: "unlisted" })).toThrow("temporarily unavailable");
    expect(researchPublication({ ...context, privacyActive: false })).toBe("public");
  });
});
