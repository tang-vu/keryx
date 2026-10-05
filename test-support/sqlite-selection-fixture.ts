/** Frozen question from #172. These eight targets are representative: the live plan text was not retained. */
export const SQLITE_SELECTION_QUESTION = "SQLite của tôi đang dùng WAL và vẫn nhận ghi khi sao lưu. Dựa trên hai tài liệu chính thức https://sqlite.org/wal.html và https://sqlite.org/backup.html, hãy so sánh việc chỉ copy file .db đang chạy với Online Backup API. Tôi cần chọn một cách tạo snapshot nhất quán mà không dừng cả service: đưa checklist thao tác, điều kiện đồng thời/khóa cần chú ý, và cách kiểm tra bản sao trước khi dùng để phục hồi. Nói rõ bước nào tài liệu hỗ trợ và bước nào còn cần kiểm chứng; không mua nguồn trả phí.";
export const SQLITE_SELECTION_QUESTION_SHA256 = "733ba7e981f55e6ff7dbd373a0ba3f7e64cf6290213d35df4d3b4186e5334be5";
export const SQLITE_SELECTION_TARGETS = [
  "Chỉ copy file .db trong WAL khi vẫn có ghi: tính nhất quán nào được hai tài liệu hỗ trợ?",
  "Chỉ copy file .db trong WAL: cần phối hợp thành phần và điều kiện đồng thời nào?",
  "Online Backup API khi service vẫn nhận ghi: tính nhất quán nào được tài liệu hỗ trợ?",
  "Online Backup API: cần chú ý điều kiện đồng thời và khóa nào?",
  "Checklist thao tác cho phương án chỉ copy .db: bước nào còn cần kiểm chứng?",
  "Checklist thao tác cho Online Backup API không dừng cả service: bước nào còn cần kiểm chứng?",
  "Kiểm tra bản sao trước khi phục hồi: checklist nào được hỗ trợ và còn cần kiểm chứng?",
  "Ranh giới giữa snapshot được tạo và khả năng phục hồi được kiểm chứng theo hai tài liệu?",
];
