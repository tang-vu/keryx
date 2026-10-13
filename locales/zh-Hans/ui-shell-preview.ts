import type { ShellDraft } from "@/lib/i18n/ui-shell-catalogue";
/** Machine draft, unreviewed, partial shell only. No payment/consent/onboarding/legal approval. */
export const uiShellPreview = {
  "shellNavigation.ask": { source: "Ask a question", text: "提出问题" },
  "shellNavigation.sources": { source: "Sources", text: "来源" },
  "shellNavigation.answers": { source: "Past answers", text: "历史回答" },
  "shellNavigation.literature": { source: "Literature workspace", text: "文献工作区" },
  "shellNavigation.creators": { source: "For creators", text: "创作者" },
  "shellNavigation.mySources": { source: "My sources", text: "我的来源" },
  "shellNavigation.myDispatches": { source: "My dispatches", text: "我的简报" },
  "shellNavigation.playground": { source: "Playground", text: "试验区" },
  "shellNavigation.developer": { source: "Dev portal", text: "开发者门户" },
  "shellHeader.creatorAction": { source: "For creators ▸", text: "创作者 ▸" },
  "shellHeader.closeMenu": { source: "Close menu", text: "关闭菜单" },
  "shellHeader.openMenu": { source: "Open menu", text: "打开菜单" },
  "shellHeader.mobileNavigation": { source: "Mobile navigation", text: "移动端导航" },
  "shellHeader.explore": { source: "Explore", text: "探索" },
  "shellHeader.moreTools": { source: "More tools", text: "更多工具" },
  "shellFooter.house": { source: "The house", text: "Keryx" },
  "shellFooter.docsAndProof": { source: "Docs & proof", text: "文档与证据" },
} satisfies ShellDraft;
