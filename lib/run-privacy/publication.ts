import { visibilitySchema, type RunVisibility } from "./contracts";

export class PublicationError extends Error {
  constructor(public readonly code: "invalid_visibility" | "privacy_unavailable" | "private_owner_required" | "parent_visibility_conflict" | "owner_changed",
    public readonly status: number, message: string) { super(message); }
}

const exposure: Record<RunVisibility, number> = { private: 0, unlisted: 1, public: 2 };

/** Creation policy only. Existing originals and visibility choices are never migrated here. */
export function researchPublication(input: {
  requested?: unknown;
  defaultVisibility?: RunVisibility;
  parentVisibility?: RunVisibility;
  privacyActive: boolean;
  hasOwner: boolean;
}): RunVisibility {
  const explicit = input.requested !== undefined;
  const parsed = visibilitySchema.safeParse(explicit ? input.requested : input.defaultVisibility ?? "public");
  if (!parsed.success) throw new PublicationError("invalid_visibility", 400, "visibility must be public, unlisted or private");
  let visibility = parsed.data;
  if (input.parentVisibility && exposure[visibility] > exposure[input.parentVisibility]) {
    if (explicit) throw new PublicationError("parent_visibility_conflict", 409,
      "This follow-up includes context from a hidden question. Keep its visibility or start a new question.");
    visibility = input.parentVisibility;
  }
  if (visibility !== "public" && !input.privacyActive) throw new PublicationError("privacy_unavailable", 503,
    "Private and unlisted research are temporarily unavailable. Your question has not been submitted.");
  if (visibility === "private" && !input.hasOwner) throw new PublicationError("private_owner_required", 401,
    "Sign in before submitting private research so you can access the saved answer.");
  return visibility;
}
