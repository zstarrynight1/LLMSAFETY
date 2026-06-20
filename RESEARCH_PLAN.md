# Research Plan: LLM-Powered Browser Extension phát hiện Code không an toàn/lỗi thời

**Mục tiêu:** Công bố Q1 Scopus trong 3-6 tháng
**Ràng buộc phần cứng:** MacBook M2 Pro, 8GB RAM, 256GB SSD (không GPU rời, không fine-tune)
**Định hướng:** Browser extension (Chrome/Edge) + LLM API, là đóng góp khoa học chính

---

## 0. Định vị nghiên cứu (đọc trước khi code bất cứ thứ gì)

### 0.1. Tiền lệ học thuật đã xác nhận (qua search 2026)
- **Verdi et al., IEEE TSE 2022** — "An Empirical Study of C++ Vulnerabilities in Crowd-Sourced Code Examples": phát hiện 69-99 snippet C++ lỗi trên Stack Overflow đã lan ra **2.800+ project GitHub**. Họ xây browser extension cảnh báo, nhưng **rule-based/CWE thủ công, chỉ giới hạn C++, không scale, extension không public**.
- **Aletheia, arXiv 2026** — browser extension dùng RAG + LLM để detect fake news ngay trên trang đang xem. Đây là **tiền lệ định dạng bài báo** ("LLM-powered browser extension cho vấn đề X") đã được chấp nhận ở venue học thuật năm 2026.
- Thị trường hiện có rất nhiều extension LLM thương mại (Monica, Sider, Merlin, ChatGPT Atlas...) nhưng đều là **trợ lý tổng quát**, không có ai làm framework khoa học chuyên biệt cho an toàn code.

### 0.2. Khoảng trống cụ thể (gap statement — PHẢI giữ nguyên logic này trong Introduction)
> "Nghiên cứu trước (Verdi et al. 2022) đã chứng minh vấn đề code snippet không an toàn lan truyền là có thật và nghiêm trọng, nhưng phương pháp phát hiện dựa trên rule/CWE thủ công có 3 hạn chế: (1) không scale sang nhiều ngôn ngữ, (2) không thích nghi với pattern lỗi mới (đặc biệt code do AI sinh ra), (3) không giải thích được NGỮ CẢNH sử dụng cụ thể. LLM hiện đại có thể giải quyết cả 3, nhưng chưa có nghiên cứu nào tích hợp LLM vào một browser extension theo phương pháp luận chặt chẽ, có đánh giá định lượng (precision/recall/cost/latency), cho bài toán này."

### 0.3. Điều KHÔNG được làm (tử huyệt #1: đề tài quá rộng)
- ❌ KHÔNG làm "trợ lý AI tổng quát cho code" — đã có Monica/Sider/Copilot, không có gì mới để claim.
- ❌ KHÔNG làm lại fake-news-detection-nhưng-đổi-domain — phải có lý do domain-specific rõ (an toàn code có đặc thù: CWE taxonomy, ngữ cảnh ngôn ngữ/framework, có ground truth khách quan hơn fake news).
- ✅ PHẢI thu hẹp: chọn 1 nền tảng nguồn code chính (StackOverflow HOẶC GitHub HOẶC cả hai), 1-3 ngôn ngữ lập trình cụ thể, 1 framing rõ ràng ("code do AI sinh ra đang lan truyền lại" là góc độ rất 2026, nên ưu tiên).

---

## 1. Phát biểu bài toán (Problem Statement) — chốt trước khi code

**Câu hỏi nghiên cứu (RQ) đề xuất — chọn 2-3, không cần cả 4:**
- RQ1: LLM (so với rule-based truyền thống) phát hiện code không an toàn/lỗi thời với precision/recall ra sao, trên benchmark thực tế?
- RQ2: Việc bổ sung context của trang web (framework, version, câu hỏi gốc) vào prompt có cải thiện độ chính xác phát hiện không?
- RQ3: Giữa các LLM khác nhau (GPT, Claude, Gemini, model mở/local), đâu là trade-off tốt nhất giữa độ chính xác – chi phí – độ trễ cho use case real-time trong extension?
- RQ4 (tùy chọn, tăng tính mới): Code snippet do LLM khác sinh ra (paste lại lên StackOverflow/blog) có tỷ lệ lỗi an toàn khác với code do người viết không? Đây là góc nhìn rất mới, gắn liền xu hướng 2026.

**Lưu ý ràng buộc:** Không cần trả lời TẤT CẢ RQ trên. Chọn ít, làm sâu, tốt hơn chọn nhiều làm hời hợt — reviewer Q1 reject vì "scope quá rộng nhưng đánh giá hời hợt" nhiều hơn vì "scope hẹp".

---

## 2. Kiến trúc kỹ thuật (thiết kế cho máy 8GB RAM, không GPU)

### 2.1. Browser Extension (Manifest V3 — bắt buộc, Manifest V2 đã bị Chrome khai tử)
```
extension/
├── manifest.json          # Manifest V3
├── content-script.js      # Inject vào trang, detect code block (DOM)
├── background.js          # Service worker, gọi API LLM
├── popup.html/js          # UI hiển thị cảnh báo
└── styles.css
```

- **Content script**: dùng `MutationObserver` để bắt code block khi trang load động (StackOverflow, GitHub dùng SPA/lazy load).
- **Phát hiện code block**: ưu tiên selector có sẵn (`<pre><code>`, class `.highlight`, `.blob-code` của GitHub) — KHÔNG dùng LLM để tìm code block, lãng phí gọi API. Chỉ dùng LLM để PHÂN TÍCH code đã extract.
- **Background service worker**: gọi API LLM, cache kết quả theo hash(code_snippet) để tránh gọi lại API cho cùng 1 đoạn code (tiết kiệm chi phí + tránh rate limit).
- **Hiển thị**: badge/icon nhỏ cạnh code block (giống Grammarly), không che giao diện gốc trang web (tránh vi phạm UX, vướng review nếu publish lên Chrome Web Store).

### 2.2. Backend / xử lý LLM (chạy được trên máy yếu)
- KHÔNG tự host model. Dùng API: OpenAI / Anthropic / Google / (tùy chọn) một model mở qua API miễn phí (Groq, Together AI) để có baseline "rẻ" trong so sánh chi phí.
- KHÔNG cần GPU vì toàn bộ suy luận diễn ra phía server của provider.
- Việc duy nhất chạy trên máy của bạn: code Extension (JS, nhẹ) + script Python/Node để build dataset, chạy batch evaluation offline (gọi API hàng loạt, không train gì).
- Để batch-eval hàng trăm/nghìn snippet mà không cháy quota: dùng async + rate limiting, chạy qua đêm nếu cần. Máy 8GB RAM đủ cho việc này (đây không phải workload nặng RAM).

### 2.3. Pipeline phát hiện (đề xuất cụ thể — đây là phần "novelty" kỹ thuật)
```
Code snippet + page context (ngôn ngữ, framework, câu hỏi gốc)
        │
        ▼
[Bước 1] Static heuristic pre-filter (regex/AST nhẹ)
        │  → loại snippet quá ngắn/không phải code thật/không liên quan an toàn
        ▼
[Bước 2] LLM-as-detector (prompt có cấu trúc: CWE taxonomy + context)
        │  → output: {vulnerable: bool, cwe_id, explanation, confidence, fix_suggestion}
        ▼
[Bước 3] (Tùy chọn, tăng độ tin cậy) LLM-as-judge thứ 2 verify lại output bước 2
        │  → giảm false positive, đây chính là đóng góp phương pháp luận
        ▼
[Bước 4] Hiển thị trên UI, kèm mức độ tin cậy
```

**Đây chính là phần bạn claim "novel method"**: kết hợp heuristic pre-filter + LLM detector + LLM verifier (self-consistency/cross-check), KHÔNG phải chỉ "bỏ code vào prompt rồi hỏi GPT có lỗi không" (quá sơ sài, reviewer sẽ chê thiếu đóng góp phương pháp).

---

## 3. Dataset & Benchmark (tử huyệt #2: dataset yếu nhất gây reject)

### 3.1. Nguồn dữ liệu
- **Ground truth có sẵn**: liên hệ/tái sử dụng dataset CWE-labeled từ Verdi et al. 2022 (nếu họ public) hoặc các dataset CWE benchmark công khai (CVEfixes, Big-Vul, Devign...) — PHẢI trích dẫn đúng, không tự nhận là dataset gốc của bạn nếu dùng lại.
- **Dataset mới bạn tự xây** (đây là phần tạo tính mới + đóng góp lâu dài):
  - Crawl code snippet từ StackOverflow (qua Stack Exchange API, miễn phí, có rate limit) theo các tag ngôn ngữ bạn chọn (ví dụ: Python, JavaScript — 2 ngôn ngữ phổ biến, nhiều dữ liệu).
  - Phân loại 2 nhóm: snippet "thường" (người viết) vs snippet nghi là AI-generated (dựa theo thời gian đăng — sau 2023 — kết hợp detector AI-text như GPTZero/DetectGPT để lọc, ghi rõ đây là proxy, không phải ground truth tuyệt đối).
  - Gán nhãn vulnerable/not bằng kết hợp: static analyzer có sẵn (Bandit cho Python, Semgrep cho đa ngôn ngữ — CHẠY ĐƯỢC TRÊN MÁY 8GB, rất nhẹ) + review thủ công một mẫu nhỏ (50-100 snippet) để tính độ tin cậy của nhãn tự động.

### 3.2. Kích thước dataset tối thiểu để Q1 chấp nhận
- Tối thiểu **500-1000 snippet** có nhãn rõ ràng để báo cáo precision/recall đáng tin.
- Một số phải có **human-verified ground truth** (ít nhất 100-150 snippet do bạn hoặc đồng nghiệp review tay) — reviewer Q1 RẤT hay hỏi "nhãn này từ đâu, độ tin cậy bao nhiêu". Không có bước này = tử huyệt.
- Báo cáo **inter-annotator agreement** (Cohen's Kappa) nếu có >1 người gán nhãn tay.

### 3.3. KHÔNG được làm (tử huyệt #3)
- ❌ Không dùng GPT-4/Claude để tự sinh nhãn rồi cũng dùng GPT-4/Claude để đánh giá → circular validation, reviewer sẽ bắt được ngay.
- ❌ Không chỉ test trên <100 snippet rồi claim "high accuracy" — quá nhỏ để có ý nghĩa thống kê.
- ❌ Không dùng duy nhất 1 LLM gán nhãn ground truth — phải có static analyzer độc lập + human spot-check.

---

## 4. Thiết kế thực nghiệm (Evaluation Design)

### 4.1. Baseline bắt buộc phải so sánh
1. Static analyzer truyền thống đơn thuần (Bandit/Semgrep) — baseline "cũ"
2. Rule-based như Verdi et al. (nếu khả thi tái lập, hoặc ít nhất discuss định tính)
3. LLM zero-shot (chỉ đưa code, không context, không pipeline) — baseline "naive LLM"
4. **Pipeline đề xuất của bạn** (heuristic + LLM detector + LLM verifier + context-aware)

Không có baseline #3 = reviewer sẽ hỏi "vậy đóng góp của pipeline là gì, hay chỉ là prompt GPT?"

### 4.2. Metrics
- Precision, Recall, F1 (theo CWE category nếu đủ dữ liệu)
- False Positive Rate (rất quan trọng cho usability — nhiều cảnh báo sai = user tắt extension)
- Chi phí: USD/1000 snippet, theo từng LLM
- Độ trễ: ms/snippet (quan trọng vì là tool real-time)
- (Nếu làm RQ4) So sánh tỷ lệ lỗi giữa code "người viết" vs "nghi AI-generated"

### 4.3. User study (tùy chọn nhưng tăng mạnh sức nặng bài báo)
- Nếu có thời gian: khảo sát nhỏ (10-20 developer) dùng thử extension, đo: có giảm thời gian phát hiện lỗi không, có gây phiền (alert fatigue) không.
- Nếu KHÔNG có thời gian: bỏ qua, đừng làm user study hời hợt (n<10, không IRB, không bảng hỏi chuẩn) — phản tác dụng.

---

## 5. Timeline 3-6 tháng (mốc cụ thể)

| Tuần | Việc |
|------|------|
| 1-2 | Hoàn thiện Related Work, xác nhận gap còn trống bằng search sâu (Scopus/Web of Science, không chỉ Google) |
| 3-5 | Xây dataset: crawl + gán nhãn (static analyzer) + chọn mẫu human-verify |
| 6-9 | Code extension prototype (content script + background + UI tối giản) |
| 10-13 | Implement pipeline detection (heuristic + LLM + verifier), chạy batch evaluation |
| 14-16 | Phân tích kết quả, vẽ bảng/biểu đồ so sánh baseline |
| 17-20 | Viết bài báo draft đầy đủ |
| 21-22 | Internal review, chỉnh sửa, format theo journal target |
| 23-24 | Submit + chuẩn bị buffer cho revision |

→ Đây là lịch ép sát 6 tháng. Nếu muốn 3 tháng: BẮT BUỘC bỏ user study, giảm dataset xuống mức tối thiểu (500 snippet), chỉ chạy 2 LLM thay vì 4+.

---

## 6. Chọn tạp chí Q1 (nhắm đúng venue để tránh mismatch)

Ưu tiên các venue có lịch sử nhận bài dạng "tool + empirical evaluation" cho software engineering / AI:
- **Expert Systems with Applications** (Elsevier, Q1) — rất quen với bài "novel framework + thực nghiệm", review nhanh hơn IEEE TSE.
- **Journal of Systems and Software** (Elsevier, Q1)
- **Information and Software Technology** (Elsevier, Q1) — đúng mảng empirical software engineering.
- **IEEE Access** (Q1 nhưng diện rộng hơn, có thể là phương án an toàn nếu venue trên reject)
- ⚠️ **IEEE Transactions on Software Engineering** — nơi bài gốc 2022 được đăng, nhưng review rất chậm (>1 năm) và khắt khe — KHÔNG hợp với deadline 3-6 tháng của bạn, chỉ nên nhắm nếu có thời gian dài hơn.

---

## 7. Checklist "không tử huyệt" trước khi submit

- [ ] Gap statement rõ ràng, có trích dẫn cụ thể bài cũ (Verdi et al. 2022) và chỉ ra hạn chế cụ thể, không nói chung "chưa ai làm"
- [ ] Có ít nhất 1 baseline non-LLM (static analyzer) và 1 baseline LLM-naive
- [ ] Dataset có nguồn gốc rõ, có nhãn được verify độc lập (không circular với LLM đang test)
- [ ] Báo cáo cả false positive rate, không chỉ accuracy/F1
- [ ] Có thảo luận về chi phí + độ trễ — vì đây là tool thực tế, không chỉ academic exercise
- [ ] Extension thực sự chạy được (có thể quay video demo/đưa link GitHub) — tăng độ tin cậy cho reviewer
- [ ] Phần Limitation trung thực: nêu rõ giới hạn ngôn ngữ lập trình đã test, giới hạn nền tảng (chỉ Chrome/StackOverflow...), không generalize quá đà
- [ ] Không claim "đầu tiên trên thế giới" nếu chưa search kỹ trên Scopus/WoS (chỉ search Google/arXiv là không đủ) — kiểm tra lại bằng chính cơ sở dữ liệu Scopus trước khi viết Introduction
- [ ] Tuân thủ chính sách Chrome Web Store nếu định public extension (không thu thập dữ liệu người dùng mà không khai báo, không vi phạm Manifest V3)
- [ ] Trích dẫn đầy đủ, kiểm tra đạo văn (Turnitin/iThenticate) trước khi submit

---

## 8. Rủi ro cần lường trước

| Rủi ro | Cách giảm thiểu |
|--------|------------------|
| LLM API rate limit/chi phí vượt dự kiến khi batch-eval | Dùng cache theo hash, test trên mẫu nhỏ trước khi chạy full |
| Static analyzer (Bandit/Semgrep) không cover hết ngôn ngữ | Giới hạn phạm vi ngôn ngữ ngay từ đầu (đừng ôm nhiều ngôn ngữ) |
| Reviewer hỏi "sao không so sánh với tool thương mại Snyk/Sider" | Chủ động thảo luận trong Related Work, giải thích tool thương mại không công khai phương pháp/không có evaluation khoa học |
| Extension bị Chrome Web Store reject khi nộp | Không bắt buộc phải public lên Store để publish bài — chỉ cần mã nguồn + demo là đủ cho mục đích khoa học |
| Đề tài bị trùng nếu có nhóm khác công bố trước trong lúc bạn làm | Theo dõi arXiv mỗi 2-3 tuần bằng từ khóa liên quan, có phương án pivot nhỏ (đổi ngôn ngữ lập trình hoặc đổi nền tảng từ StackOverflow sang GitHub) nếu phát hiện trùng |

---

## 9. Việc cần làm NGAY (3 hành động đầu tiên)

1. Search lại trên **Scopus/Web of Science trực tiếp** (không chỉ Google Scholar/arXiv) với từ khóa: `browser extension` + `vulnerability detection` + `large language model`, để chắc chắn 100% gap còn trống — vì search engine tổng quát có thể bỏ sót bài đã index trên Scopus.
2. Setup môi trường: Node.js + Chrome Extension boilerplate (Manifest V3) + API key (Anthropic/OpenAI) + Semgrep/Bandit cài local.
3. Crawl thử 50-100 snippet mẫu từ Stack Exchange API để kiểm tra tính khả thi của pipeline gán nhãn trước khi cam kết toàn bộ dataset.
