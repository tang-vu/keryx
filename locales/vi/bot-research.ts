import type { BotResearchCatalogue } from "../en/bot-research";

/** Agent-authored ordinary bot copy; no human translation approval is claimed. */
export const botResearchVietnamese = Object.freeze({
  citationHeading: "Trích dẫn và phần thưởng dự kiến (USDC)",
  slackCitationHeading: "Trích dẫn và phần thưởng dự kiến — phần thưởng trích dẫn USDC theo trọng số",
  weight: "trọng số {weight}",
  sourcesOne: "Đã trích dẫn {count} nguồn",
  sourcesOther: "Đã trích dẫn {count} nguồn",
  recordedCreators: "Đã ghi nhận {amount} cho người sáng tạo",
  recordedCreatorTotal: "Tổng thanh toán cho người sáng tạo được ghi nhận: {amount}",
  settlementNotice: "Số tiền được ghi nhận không phải bằng chứng thanh toán hoàn tất; hãy kiểm tra biên nhận trong toàn bộ vết thực thi.",
  slackSettlementNotice: "Phần thưởng dự kiến không phải bằng chứng thanh toán hoàn tất. Xem vết thực thi để biết các khoản thanh toán đã hoàn tất, đang chờ, thất bại hoặc được mô phỏng.",
  discordSettlementNotice: "Số tiền được ghi nhận không phải bằng chứng thanh toán hoàn tất; hãy kiểm tra biên nhận qua liên kết ở tiêu đề",
  fullTrace: "Toàn bộ vết thực thi: {url}",
  failure: "⚠️ Keryx không thể hoàn thành lượt nghiên cứu này: {detail}",
  paused: "Nghiên cứu mới tạm dừng trong khi một lần giao kết quả trước đó được xem xét. Bạn vẫn có thể xem báo cáo đã lưu. Tăng ngân sách nguồn hoặc kết nối ví không gỡ bỏ việc tạm dừng này. Câu hỏi của bạn chưa được thử lại.",
  treasuryUnavailable: "Ví ngân quỹ của Keryx chưa được cấu hình trên bản triển khai này.",
  sponsoredLimited: "Các lượt nghiên cứu được tài trợ tạm thời bị giới hạn hoặc không khả dụng — hãy thử lại sau một phút.",
  dispatching: "⏳ Keryx đang nghiên cứu — mua nguồn và thanh toán cho các trích dẫn…",
  discordUsage: "Ở đây chỉ hỗ trợ `/ask question:<text>`.",
} satisfies BotResearchCatalogue);
