/** Inert, internally authored evaluation inputs. Importing these never performs I/O. */
export interface InternalResearchSource {
  title: string;
  url?: string;
  text?: string;
  /** Authoring-time provenance only; the execution must retain its own read scope. */
  observedScope?: string;
  fixture?: {
    kind: "abstract" | "text" | "text-pdf" | "image-only-pdf" | "versioned-text";
    artifactPath?: string;
    /** Expected fixture behavior, never an assertion that the production reader ran. */
    expectedReadError?: string;
    truncated?: boolean;
    version?: string;
    originId?: string;
  };
}

export interface InternalResearchInput {
  id: string;
  question: string;
  targets: string[];
  /** Public inputs may include explicitly fictional workload assumptions in the question. */
  inputKind: "public-original" | "synthetic" | "repository";
  sources: InternalResearchSource[];
  expectedArtifact: string;
  /** Manual acceptance criteria, not assertions that the expected artifact was delivered. */
  review: string[];
}
