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

Mặc định extension dùng `MockProvider` (dữ liệu giả) — chưa cần API key thật để xem extension
hoạt động end-to-end. Để dùng LLM thật (Anthropic): mở popup extension → dán Anthropic API key
vào ô **Anthropic API key** → bấm **Lưu key**. Key được lưu trong `chrome.storage.local` của
trình duyệt, không nằm trong code/constants.js.

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
pip install -r research/requirements.txt
cp .env.example .env   # rồi điền API key thật vào .env (đã gitignore)
```

`bandit`/`semgrep` (dùng trong `label_snippets.py`) chưa cài sẵn trên máy dev — cần cài thêm
qua `pip install bandit semgrep` trước khi gán nhãn dataset thật.

## Research — chạy test

```bash
source .venv/bin/activate
pytest tests/research
```

## Research — crawl & gán nhãn dataset (Python + JavaScript)

```bash
# Crawl thử nhỏ truoc (khong ton phi, API cong khai khong can key) - theo dung
# RESEARCH_PLAN.md muc 9: thu 50-100 snippet de kiem tra pipeline truoc khi crawl full.
python research/data-collection/crawl_stackoverflow.py --languages python javascript --limit 50

# Gan nhan bang Bandit (Python) + Semgrep (Python/JavaScript), xuat them mau 50 snippet de
# human-verify thu cong (RESEARCH_PLAN.md muc 3.2).
python research/data-collection/label_snippets.py \
  --input research/data-collection/raw-data/python.jsonl \
  --output research/data-collection/raw-data/python.labels.jsonl \
  --human-sample-size 50
```

Trước khi crawl **full dataset** (không giới hạn `--limit`), xác nhận với người review:
đã cài Bandit/Semgrep, số lượng snippet target, và tuân thủ phạm vi ngôn ngữ đã chốt
(Python + JavaScript).

## Research — chạy 4 baseline đánh giá (RESEARCH_PLAN.md mục 4.1)

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # chỉ cần khi KHÔNG dùng --dry-run

# Baseline 1: static analyzer thuần (Bandit/Semgrep), không LLM
python research/evaluation/run_baseline_static.py \
  --input research/data-collection/raw-data/python.jsonl \
  --output research/evaluation/results/baseline_static.jsonl

# Baseline 3: LLM zero-shot, không context (--dry-run để test trước, không tốn phí/không cần key)
python research/evaluation/run_llm_naive.py \
  --input research/data-collection/raw-data/python.jsonl \
  --output research/evaluation/results/baseline_naive.jsonl \
  --dry-run

# Pipeline đề xuất: heuristic + LLM-detector (context-aware) + LLM-judge (mặc định bật)
python research/evaluation/run_pipeline.py \
  --input research/data-collection/raw-data/python.jsonl \
  --output research/evaluation/results/pipeline.jsonl \
  --dry-run
# --no-judge: tắt bước 3 (LLM-as-judge) để chạy ablation 2 bước so sánh
```

Bỏ `--dry-run` để gọi API thật: script sẽ in **chi phí ước tính** và hỏi xác nhận trước khi
chạy nếu dataset >100 snippet (theo coding-rules.md mục 4.4 — không tự động chạy ngầm).
Baseline 2 (rule-based kiểu Verdi et al. 2022) **không implement code** — chỉ discuss định
tính trong bài báo (RESEARCH_PLAN.md mục 4.1 cho phép, theo quyết định của user).

Kết quả mỗi baseline là 1 file `.jsonl` (mỗi dòng = 1 snippet). Dùng `research/evaluation/metrics.py`
(hàm `summarize()`) để tính Precision/Recall/F1/FPR/chi phí/độ trễ — cần tự nối kết quả với nhãn
ground-truth (`label_human` từ `label_snippets.py`) theo `question_id` trước khi gọi `summarize()`.

## Publish lên Chrome Web Store

Không bắt buộc cho mục đích nghiên cứu (xem RESEARCH_PLAN.md mục 8) — nhưng nếu muốn public:
xem `docs/chrome-web-store-listing.md` (checklist, mô tả listing, justification permissions,
lệnh đóng gói zip) và `docs/privacy.html` (privacy policy — cần publish qua GitHub Pages,
Settings → Pages → branch `main` / folder `/docs`, rồi điền URL đó vào Developer Dashboard).
Bước nộp/trả phí/submit review phải tự làm thủ công trên Google Developer Dashboard.

## Lưu ý bảo mật

- Không bao giờ commit `.env` hoặc bất kỳ file nào chứa API key thật.
- Không commit dữ liệu thô đã crawl (`research/data-collection/raw-data/` đã có trong
  `.gitignore`).
