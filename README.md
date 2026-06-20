# LLM-Powered Code Safety Browser Extension

Nghiên cứu khoa học kết hợp Chrome extension + LLM API để phát hiện code snippet không an toàn
ngay trên trang đang xem (StackOverflow/GitHub). Xem `RESEARCH_PLAN.md` để biết bối cảnh nghiên
cứu, và `.claude/rules/coding-rules.md` để biết quy tắc code bắt buộc.

## Cấu trúc dự án

```
extension/   - Chrome extension (Manifest V3, JavaScript)
research/    - Crawl dữ liệu, gán nhãn, batch evaluation (Python)
tests/       - Test cho cả 2 phần trên, tách riêng theo extension/research
```

`extension/` và `research/` không import chéo lẫn nhau.

## Extension — chạy thử (load unpacked)

1. Mở Chrome → `chrome://extensions`.
2. Bật **Developer mode** (góc trên phải).
3. Chọn **Load unpacked**, trỏ vào thư mục `extension/` trong repo này.
4. Extension sẽ hoạt động trên các trang `stackoverflow.com` và `github.com`.

Hiện tại phần gọi LLM API dùng `MockProvider` (dữ liệu giả) — chưa cần API key thật để xem
extension hoạt động end-to-end.

## Extension — chạy test

```bash
npm install
npm test
```

Test dùng Jest, mock toàn bộ `chrome.*` API và LLM provider — không gọi network thật.

## Research — setup môi trường Python

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r research/requirements.txt   # sẽ thêm khi có script research
cp .env.example .env   # rồi điền API key thật vào .env (đã gitignore)
```

## Research — chạy test

```bash
pytest tests/research
```

## Lưu ý bảo mật

- Không bao giờ commit `.env` hoặc bất kỳ file nào chứa API key thật.
- Không commit dữ liệu thô đã crawl (`research/data-collection/raw-data/` đã có trong
  `.gitignore`).
