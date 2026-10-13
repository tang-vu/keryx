# Website setup and integration discovery

Owner direction: make app, MCP, API, extension and other supported entry points
discoverable on the website; learn applicable patterns from ChatGPT, Claude and
other AI products. The public interface remains English, consistent with the
existing shipped catalogue.

## Applied patterns and primary sources

- [ChatGPT downloads](https://chatgpt.com/download/) makes downloading visible in
  navigation and groups desktop, mobile and extension options. Keryx applies a
  visible setup entry and a download page, offering only its published platforms.
- [Claude downloads](https://claude.com/download) puts platform downloads,
  extensions, developer environments, requirements and FAQs together. Keryx
  adopts explicit requirements, installation steps and honest alpha/manual status.
- [Claude connector directory](https://claude.com/marketplace/connectors-plugins)
  presents integrations by purpose with direct setup actions. Keryx uses a small
  curated directory; seven supported surfaces do not need search or marketplace
  infrastructure.
- [Perplexity API quickstart](https://docs.perplexity.ai/docs/getting-started/quickstart)
  leads developers from configuration to a request. Keryx provides copyable base
  URL/model, a read-only model check and a labelled sponsored request, then links
  its authoritative SDK/OpenAPI documentation.

These are design adaptations, not claims of interoperability with every product
or copying their supported platforms, OAuth, accounts or billing capabilities.

## Source outcome and acceptance

The web-only source candidate adds server-rendered `/get-started`, `/download` and
`/integrations`. Header, home, footer, sitemap, README and `llms.txt` link them.
The setup guide separates hosted trial research from caller-funded buyers and
retains public-report, payment-state and interrupted-job recovery disclosures.
Copy buttons do not execute commands and report clipboard failure accurately.

Installer links pin published v0.27.63 / source
`ec5f39c9750dfc9e80e66edd41348ca6034c01c3`. Physical release readback matches
the accepted Desktop CI run 38263715521 / artifact 11754521388: Operator 0.4.17
and installer SHA256
`c4b42a16f8989fbc178cc1824d0f7ae3d9f4ece5e3d91526b2b8cc1d48cc4388`.
All 22 portable members and the installer match the accepted CI artifact;
the source manifest and release checksums bind this exact commit.
The same source's extension is 0.1.4.2, offered as a project source ZIP with
explicit instructions to select its `extension/` directory. No unverified Chrome
Web Store install link is invented. npm and official MCP Registry readback
established keryx-mcp 0.4.19 after publisher run 38272439384 succeeded. Its whole
184801-byte npm tarball, SHA512 integrity, package descriptors and signed source
provenance match accepted source `ec5f39c9750dfc9e80e66edd41348ca6034c01c3`;
Sigstore verification used trusted roots and the explicit GitHub workflow identity.
The stdio example pins that published version. These observations establish published artifacts,
not an installed client or a future release.

Acceptance requires type checking, scoped lint/copy guard, production build,
built informational-page checks at desktop and mobile widths, keyboard navigation,
clipboard success/failure and absence of research/payment dispatch. Required
hosted aggregate and applicable source review precede merge; deployed commit and
public page readback precede delivery claims. Installation and real research are
not exercised by informational checks.

Local verification passed: application and ops TypeScript checks, scoped ESLint,
UI-copy guard, production build, and the extended built product-guide fixture at
320/390/1024/1366px. It checks all seven entry cards, canonical/sitemap/llms links,
keyboard FAQ and section navigation, pinned artifact links and clipboard success
and refusal without dispatching research or payment. Chromium's existing mobile
header/wallet fixture also passed after keeping Activity in the primary menu.
Independent read-only source review resolved a README anchor and Bash shell label;
no blocking source finding remained. Hosted CI and production delivery are still
independent gates, not established by these local observations.

## Surface audit

| Surface | Coordinated role in this outcome |
| --- | --- |
| Web | New setup/download/integration routes and navigation; visible on mobile and desktop. |
| Desktop | Published Windows alpha links, platform/runtime requirements, manual updates and explicit buyer handoff. No installer runtime change. |
| Remote MCP | Existing `/integrations/mcp` remains the client-specific setup/probe authority; new directory explains HTTP and scope boundaries. No protocol change. |
| Stdio MCP | Published 0.4.19 configuration and custody/funding/recovery guide. No package runtime change. |
| API | OpenAI-compatible setup and OpenAPI/key links; paid x402 agent API remains distinct. Application/spec release identity remains owned by the release coordinator. |
| CLI | Source installation and help commands; buyer and Operator guides retain custody/network roles. No command runtime change. |
| Extension | Pinned source install instructions and public-trial/privacy limits. No extension runtime or manifest change. |
| Bots | Documented Telegram/Discord links; Slack administrator setup, with no invented OAuth install path. No bot adapter change. |

Web-only setup copy and installation constants are not imported by packaged client
entry points. Retained MCP, desktop, extension and native artifacts preserve their
original versions/source provenance. No new funding, spending, custody, DDL,
background schedule, pilot activation or OAuth support follows from this update.
