# Project: LLM-Powered Code Safety Browser Extension

Nghiên cứu khoa học (mục tiêu công bố Q1 Scopus) kết hợp Chrome extension + LLM API
để phát hiện code snippet không an toàn ngay trên trang đang xem (StackOverflow/GitHub).

## Bắt buộc đọc trước khi code

- Coding rules chi tiết (cấu trúc, naming, security, LLM API, error handling, git):
  xem `.claude/rules/coding-rules.md` — LUÔN tuân theo, không tự ý làm khác.
- Bối cảnh nghiên cứu, research questions, dataset, timeline:
  xem `RESEARCH_PLAN.md` ở root — đọc khi cần hiểu "tại sao", không phải "làm sao".

## Quy tắc tối thượng (nhắc lại, không thay thế file rules)

1. Không tự mở rộng phạm vi nghiên cứu hoặc tính năng ngoài yêu cầu.
2. Không hardcode API key. Không log/commit dữ liệu người dùng.
3. Mọi lệnh gọi LLM API phải qua `src/background/llm-client.js`, theo đúng khung
   trong coding-rules.md (validate → cache → retry+timeout → validate output → log usage).
4. Khi không chắc (schema API, hành vi Chrome Extension, quyết định ảnh hưởng tới
   thiết kế nghiên cứu) → DỪNG LẠI VÀ HỎI, không tự đoán.
5. Trước khi báo "đã xong" task: phải có test chạy pass, không tự nhận hoàn thành.

## Stack

- Extension: JavaScript, Manifest V3 (Chrome)
- Research/Evaluation: Python (crawl, gán nhãn, batch evaluation với static analyzer + LLM)
- Máy dev: MacBook M2 Pro, 8GB RAM — không train/fine-tune model, chỉ gọi API.
