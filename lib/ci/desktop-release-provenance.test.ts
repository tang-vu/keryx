import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../.github/workflows/desktop-release.yml", import.meta.url), "utf8");
const lines = source.replace(/\r\n/g, "\n").split("\n");
const start = lines.indexOf("          script: |");
if (start < 0) throw new Error("Desktop source-resolution script is missing");
let end = start + 1;
while (end < lines.length && (!lines[end].trim() || lines[end].startsWith("            "))) end++;
const script = lines.slice(start + 1, end).map(line => line.slice(12)).join("\n");

const definition = "a".repeat(40), upstream = "b".repeat(40), other = "c".repeat(40);
const tag = "v0.27.93", callbackId = 1001, upstreamId = 1000, acceptedRunId = 900;
type Mode = "release-missing" | "different-source" | "acceptance-pending" | "ready" | "read-error" | "annotated-tag";

async function resolve(mode: Mode, eventName = "workflow_run") {
  const target = mode === "different-source" ? other : upstream;
  const info = vi.fn(), setOutput = vi.fn();
  const actions = { listWorkflowRuns: vi.fn(), listJobsForWorkflowRun: vi.fn(), listWorkflowRunArtifacts: vi.fn() };
  const github = {
    rest: {
      repos: {
        getContent: vi.fn(async () => ({ data: { content: Buffer.from(JSON.stringify({ version: "0.27.93" })).toString("base64") } })),
        getReleaseByTag: vi.fn(async () => {
          if (mode === "release-missing") throw Object.assign(new Error("Release missing"), { status: 404 });
          if (mode === "read-error") throw Object.assign(new Error("Read refused"), { status: 403 });
          return { data: { draft: false, assets: [] } };
        }),
      },
      git: {
        getRef: vi.fn(async () => ({ data: { object: { type: mode === "annotated-tag" ? "tag" : "commit", sha: mode === "annotated-tag" ? other : target } } })),
        getTag: vi.fn(async () => ({ data: { object: { type: "commit", sha: target } } })),
      },
      actions,
    },
    paginate: vi.fn(async (method: unknown) => {
      if (method === actions.listWorkflowRuns) return mode === "acceptance-pending" ? [] : [{ id: acceptedRunId, head_sha: target, conclusion: "success" }];
      if (method === actions.listJobsForWorkflowRun) return ["packaged-smoke", "Fresh runner packaged desktop acceptance"].map(name => ({ name, conclusion: "success" }));
      if (method === actions.listWorkflowRunArtifacts) return [{ name: `operator-desktop-${target}-${acceptedRunId}`, expired: false }];
      throw new Error("Unexpected API operation");
    }),
  };
  const context = { repo: { owner: "owner", repo: "repo" }, eventName, sha: definition, runId: callbackId,
    payload: { privateField: "NEVER_LOG_PRIVATE_PAYLOAD", workflow_run: { id: upstreamId, head_sha: upstream, name: "CI" } } };
  let error: unknown;
  try {
    await runInNewContext(`(async () => {\n${script}\n})()`, {
      github, context, core: { info, setOutput }, Buffer, process: { env: { RELEASE_TAG: tag, SECRET: "NEVER_LOG_PRIVATE_PAYLOAD" } },
    }, { timeout: 1000 });
  } catch (caught) { error = caught; }
  const provenance = info.mock.calls.map(([message]) => String(message))
    .filter(message => message.startsWith("desktop-release-provenance "))
    .map(message => JSON.parse(message.slice("desktop-release-provenance ".length)));
  expect(info.mock.calls.flat().join("\n")).not.toContain("NEVER_LOG_PRIVATE_PAYLOAD");
  return { provenance, setOutput, github, error };
}

it.each(["release-missing", "different-source", "acceptance-pending", "ready"] as const)(
  "records the triggering source separately from workflow definition before automatic %s", async mode => {
    const result = await resolve(mode);
    expect(result.error).toBeUndefined();
    expect(result.provenance[0]).toEqual({ phase: "trigger", eventName: "workflow_run", callbackRunId: callbackId,
      workflowDefinitionSha: definition, upstreamRunId: upstreamId, upstreamSourceSha: upstream, upstreamWorkflow: "CI" });
    expect(result.provenance).toHaveLength(mode === "release-missing" ? 1 : 2);
    if (mode !== "release-missing") expect(result.provenance[1]).toEqual({ phase: "release", callbackRunId: callbackId,
      releaseTag: tag, releaseSourceSha: mode === "different-source" ? other : upstream });
    if (mode === "ready") expect(result.setOutput).toHaveBeenCalledWith("ready", "true");
    else expect(result.setOutput).not.toHaveBeenCalled();
    if (mode === "release-missing" || mode === "different-source") expect(result.github.paginate).not.toHaveBeenCalled();
  },
);

it.each(["release", "workflow_dispatch"])("does not invent upstream provenance for %s admission", async eventName => {
  const result = await resolve("ready", eventName);
  expect(result.error).toBeUndefined();
  expect(result.provenance).toEqual([
    { phase: "trigger", eventName, callbackRunId: callbackId, workflowDefinitionSha: definition,
      upstreamRunId: null, upstreamSourceSha: null, upstreamWorkflow: null },
    { phase: "release", callbackRunId: callbackId, releaseTag: tag, releaseSourceSha: upstream },
  ]);
  expect(result.github.rest.repos.getContent).not.toHaveBeenCalled();
  expect(result.setOutput).toHaveBeenCalledWith("ready", "true");
});

it("retains trigger attribution when a release read fails and still refuses admission", async () => {
  const result = await resolve("read-error");
  expect(result.error).toMatchObject({ status: 403 });
  expect(result.provenance).toHaveLength(1);
  expect(result.provenance[0]).toMatchObject({ upstreamRunId: upstreamId, upstreamSourceSha: upstream, workflowDefinitionSha: definition });
  expect(result.setOutput).not.toHaveBeenCalled();
  expect(result.github.paginate).not.toHaveBeenCalled();
});

it("records the resolved commit of an annotated release tag", async () => {
  const result = await resolve("annotated-tag");
  expect(result.error).toBeUndefined();
  expect(result.github.rest.git.getTag).toHaveBeenCalledOnce();
  expect(result.github.rest.git.getTag).toHaveBeenCalledWith({ owner: "owner", repo: "repo", tag_sha: other });
  expect(result.provenance[1]).toMatchObject({ releaseSourceSha: upstream });
  expect(result.setOutput).toHaveBeenCalledWith("ready", "true");
});
