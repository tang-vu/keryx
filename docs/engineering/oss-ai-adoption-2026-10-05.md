# OSS AI patterns applied to Keryx — October 5, 2026

The owner requested broad learning from current open-source AI projects and
skills, followed by concrete application to Keryx. This survey checks primary
repositories and documentation on October 5. It is a relevance-based sample,
not a ranking of every project or evidence that a new framework improves Keryx.
Repository HEAD pins below were read from GitHub's API; they are snapshots, not
necessarily published versions. Documentation links were inspected separately
and can change after this date.

## Sources and disposition

| Primary source and checked HEAD | Useful pattern | Keryx disposition |
| --- | --- | --- |
| [Anthropic Skills](https://github.com/anthropics/skills/tree/683bc88e56f3e09ba94f7055977f3d3aa499f202) | Task-specific `SKILL.md` entrypoints with supporting resources | Applied in a new repo-local OSS adoption skill; original instructions, no upstream skill/code copied. Licensing varies by skill; no blanket license inferred. |
| [Agent Skills specification](https://github.com/agentskills/agentskills/tree/69ef37e9424c0a7ea9dd2293b559e43ec8176379), [format](https://agentskills.io/specification) | Portable name/description frontmatter and progressive disclosure | Keep focused `.agents/skills` discovery and link the detailed adoption record on demand. Repository license observed: Apache-2.0. |
| [Deep Agents](https://github.com/langchain-ai/deepagents/tree/64711b8c1d8860aa38fde350c35b8506697e5b3e), [skills](https://docs.langchain.com/oss/python/deepagents/skills) | Load expertise on demand; constrain actions at tool/backend boundaries | Applied to developer skill layout and the distinction between reasoning suggestions and code-enforced spend. No harness replacement. Repository license observed: MIT. |
| [Mastra](https://github.com/mastra-ai/mastra/tree/35eeb5ecd1a80653c9e1aade3eccfca38d8072ef), [memory](https://mastra.ai/docs/memory/overview) | Explicit resource/thread scope and inspectable context assembly | Review how historical source data enters the model. Do not copy its system-message memory placement into Keryx's publisher-controlled names. A user/private memory expansion needs an access-scope design. GitHub reported NOASSERTION; component licensing remains unreviewed. |
| [Google ADK](https://github.com/google/adk-python/tree/6be386d8939c4898aa2c0fc8a1f7cb34e7df7904), [evaluation](https://adk.dev/evaluate/) | Evaluate intermediate tool trajectory separately from final response | Apply this distinction to adoption acceptance and existing agent tests; adding ADK's Python runtime has no demonstrated benefit here. Repository license observed: Apache-2.0. |
| [Microsoft Agent Framework](https://github.com/microsoft/agent-framework/tree/2df61296bb563a95552b18491ad29b1e1a509f81) | Checkpointed workflows and human intervention | Reference for future Operator orchestration. Keryx already journals financial originals; a workflow checkpoint cannot authorize replaying a payment. No migration in this update. Repository license observed: MIT. |
| [Vercel Skills](https://github.com/vercel-labs/skills/tree/18f96ea131dab3b0fcc9b27cf7c6f6cbb6174680) | Select and distribute skills across agent tools | Use the portable folder shape; inspect/pin individual external skills before adoption. No catalog-wide install or automatic upstream execution. Repository license observed: MIT. |
| [Promptfoo](https://github.com/promptfoo/promptfoo/tree/b56166bda60396ce06ff25a7f2386956d100ffa6), [assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/) | Separate deterministic assertions from model-graded output metrics | Apply that separation to the new regression and reported evidence. Keryx's existing Vitest/frozen-corpus harness covers this slice without another evaluator dependency. Repository license observed: MIT. |

These are architectural lessons and Keryx-specific inferences. None of the
upstream projects certifies Keryx's payment safety or research usefulness.

## Concrete runtime improvement

Baseline `1b12d108`: `buildDecisionContext` derives subject-scoped historical
performance and reputation using the current candidate names. Those names can
be publisher-controlled. `JsonChatEngine.decide` previously concatenated the
history into the system message, promoting a source-owned instruction into the
same channel as research policy. Candidate metadata was otherwise serialized
as user-message data.

The fix keeps the complete optional `memoryContext` in the JSON user payload.
The system message now contains only static research policy and explicit guidance
about untrusted candidate/history fields. Historical performance can help compare
equally promising candidates; it is not current evidence or spending authority.
No source text is removed or rewritten. Subject scoping, sample thresholds,
current prices, target validation and code-enforced budget/payment rules retain
their existing implementations.

Integration with the subsequently merged source-selection repair (#174) retains
its exact candidate/target validation, request-local refusal and sanitized failure
diagnostics. The history still stays in JSON data; it is not interpolated inside
the new transport/validation error handling.

Integration also retains #180's discovery across Deep research targets and its
document-relevance guidance for free reads. Historical context remains a weak
hint; it cannot replace current candidate relevance or paid-toll limits.

The new test constructs actual aggregated history from five synthetic runs and
a source name containing instruction-like text and a JSON/schema override. It
checks that the publisher text stays out of system policy, the JSON round-trip
preserves the history, and current budget/schema/price/targets remain intact.
A second check compares policy across absent, ordinary and hostile history.
Both checks failed against the baseline and passed after the fix.

These checks prove prompt role separation and serialization, not that any live
model ignores every injection. This update does not claim improved answer
usefulness, lower token cost, live provider acceptance or real settlement. A new
finite live comparison remains subject to the existing provider/payment gates;
closed evaluations and disabled decision briefs remain closed.

## Supported surfaces and release scope

| Surface | Applicability |
| --- | --- |
| Web/SSE and browser/API research | Use the shared JSON reasoning engine; receive the corrected decision context. Request/response and signing contracts are unchanged. |
| Hosted A2A and private research workers | Use the same engine when their configured provider inherits `JsonChatEngine`. Private effects intentionally supply no shared historical memory; this update does not activate it. Preserve disclosure, caps and journals. |
| Direct `ask`/demo CLI | Uses the shared engine for real JSON providers. Explicit offline heuristic reasoning does not use this prompt. |
| Remote MCP, stdio MCP and caller-funded buyer CLI | Delegate research to hosted endpoints. No client bundle/protocol changes or package republishing required for this fix. |
| Windows desktop/Operator | Task preparation, inspection and saved results keep their current local engine; research handed to the service receives the hosted fix. No installer byte changes required. |
| Browser extension, Telegram, Discord and Slack adapters | Existing server-backed research uses the shared fix; no adapter contract change. |
| Repository development agents | New `.agents/skills/keryx-oss-adoption` is discoverable in supporting agents; no runtime skill loader, arbitrary script runner or autonomous scheduler is introduced. |

Acceptance: regression fails before/passes after; adjacent engine, memory and
orchestration tests pass; TypeScript and lint pass; required CI and independent
review pass. Hosted delivery additionally requires the reviewed deployment and
exact `/api/health` commit readback. Only app identity changes to 0.26.21; MCP,
desktop and extension identities retain their existing roles. See
[the evaluation harness](../agent-evaluation.md) and
[mainnet update flow](../mainnet-update-flow.md) for those separate gates.

## Follow-up experiments, not shipped claims

- Runtime research skills: first demonstrate that a bounded, curated task rubric
  improves a frozen research corpus. Pin instruction provenance and keep it out
  of payment authority; do not add remote skill execution before an actual need.
- Private/workspace memory: evaluate explicit owner/task access scope before
  expanding beyond the existing public source-performance aggregates. Compression
  must preserve uncertainty, original evidence and recovery obligations.
- Long-task context offloading: measure retained evidence completeness and
  end-to-end usefulness against the existing bounded evidence selector before
  adopting a harness or summarizer. Token savings alone do not pass acceptance.

The repository skill reuses this workflow for future user-directed research.
It is not a background learning process and creates no recurring schedule.
