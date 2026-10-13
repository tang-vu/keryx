import type { ShellDraft } from "@/lib/i18n/ui-shell-catalogue";
/** Machine draft, unreviewed, partial shell only. No payment/consent/onboarding/legal approval. */
export const uiShellPreview = {
  "shellNavigation.ask": { source: "Ask a question", text: "Đặt câu hỏi" },
  "shellNavigation.sources": { source: "Sources", text: "Nguồn" },
  "shellNavigation.answers": { source: "Past answers", text: "Câu trả lời trước đây" },
  "shellNavigation.literature": { source: "Literature workspace", text: "Không gian tài liệu" },
  "shellNavigation.creators": { source: "For creators", text: "Dành cho tác giả" },
  "shellNavigation.mySources": { source: "My sources", text: "Nguồn của tôi" },
  "shellNavigation.myDispatches": { source: "My dispatches", text: "Bản tin của tôi" },
  "shellNavigation.playground": { source: "Playground", text: "Khu thử nghiệm" },
  "shellNavigation.developer": { source: "Dev portal", text: "Cổng lập trình viên" },
  "shellHeader.creatorAction": { source: "For creators ▸", text: "Dành cho tác giả ▸" },
  "shellHeader.closeMenu": { source: "Close menu", text: "Đóng menu" },
  "shellHeader.openMenu": { source: "Open menu", text: "Mở menu" },
  "shellHeader.mobileNavigation": { source: "Mobile navigation", text: "Điều hướng trên điện thoại" },
  "shellHeader.explore": { source: "Explore", text: "Khám phá" },
  "shellHeader.moreTools": { source: "More tools", text: "Công cụ khác" },
  "shellFooter.house": { source: "The house", text: "Keryx" },
  "shellFooter.docsAndProof": { source: "Docs & proof", text: "Tài liệu và bằng chứng" },
} satisfies ShellDraft;
