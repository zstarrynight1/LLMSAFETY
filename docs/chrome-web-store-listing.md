# Chrome Web Store — nội dung tham khảo khi nộp listing

File này KHÔNG được Chrome Web Store đọc tự động — chỉ để bạn copy-paste thủ công vào
[Developer Dashboard](https://chrome.google.com/webstore/devconsole) khi nộp extension.

## Trước khi nộp (checklist)

- [ ] Tài khoản Google Developer đã đăng ký + đã trả phí đăng ký một lần (5 USD).
- [ ] `docs/privacy.html` đã được publish qua GitHub Pages (Settings → Pages → Source: branch
      `main`, folder `/docs`) và bạn có URL công khai dạng
      `https://<username>.github.io/<repo>/privacy.html`.
- [ ] Đã điền link repo thật vào `docs/privacy.html` (hiện đang để placeholder).
- [ ] Đã chạy `npm test` và `pytest tests/research` pass (xem README.md).
- [ ] Đã đóng gói extension: xem mục "Đóng gói" bên dưới.

## Tên extension

```
Code Safety Checker
```

## Mô tả ngắn (tối đa 132 ký tự, hiển thị trong kết quả tìm kiếm)

```
Phát hiện code snippet không an toàn trên StackOverflow/GitHub bằng LLM, ngay khi bạn đang xem.
```

## Mô tả chi tiết

```
Code Safety Checker là extension nghiên cứu khoa học giúp phát hiện code không an toàn hoặc
lỗi thời ngay trên trang StackOverflow/GitHub bạn đang xem, thay vì phải tự kiểm tra thủ công.

CÁCH HOẠT ĐỘNG
- Tự động nhận diện code block trên trang (StackOverflow, GitHub).
- Gửi nội dung code tới LLM (Anthropic Claude) để phân tích theo CWE taxonomy.
- Hiển thị cảnh báo ngay cạnh code block nếu phát hiện vấn đề, kèm mức độ tin cậy và gợi ý sửa.
- Cache kết quả theo mã băm nội dung để tránh phân tích lại, tiết kiệm chi phí.

QUYỀN RIÊNG TƯ
- Chỉ hoạt động trên stackoverflow.com và github.com — không truy cập trang nào khác.
- Không thu thập lịch sử duyệt web, cookie, hay thông tin định danh cá nhân.
- Bạn cần đồng ý thông báo quyền riêng tư trước khi extension gửi code đi phân tích lần đầu.
- Có thể tắt extension hoặc xoá API key bất kỳ lúc nào qua popup.
- Xem chi tiết: [link docs/privacy.html]

Đây là dự án nghiên cứu mã nguồn mở, không thu thập dữ liệu cho mục đích quảng cáo.
```

## Category

```
Developer Tools
```

## Justification cho permissions (Chrome Web Store review sẽ hỏi)

| Permission/host | Lý do |
|---|---|
| `storage` | Lưu cache kết quả phân tích (theo hash nội dung), API key người dùng tự nhập, trạng thái bật/tắt — toàn bộ cục bộ trong trình duyệt, không đồng bộ lên server của nhóm phát triển. |
| `host_permissions`: `*.stackoverflow.com`, `*.github.com` | Extension CHỈ cần đọc code block trên 2 domain này để thực hiện chức năng chính — không xin quyền `<all_urls>`. |

## Single purpose description (CWS yêu cầu mô tả "1 mục đích duy nhất")

```
Phát hiện code không an toàn trên StackOverflow/GitHub bằng cách phân tích code snippet qua LLM
và hiển thị cảnh báo trực tiếp trên trang.
```

## Đóng gói extension để upload

```bash
cd extension
zip -r ../code-safety-checker-extension.zip . -x ".*" -x "*.DS_Store" -x "*/.DS_Store"
```

Upload file `code-safety-checker-extension.zip` (không phải toàn bộ thư mục) vào Developer
Dashboard. Lưu ý: KHÔNG zip cả thư mục `extension/` làm thư mục gốc bên trong zip — `manifest.json`
phải nằm ngay tại root của file zip.
