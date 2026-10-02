# Hướng dẫn cho Agent — Chế độ tự chủ hoàn toàn

## Nguyên tắc chung

- Bạn được toàn quyền thực hiện mọi tác vụ trong dự án này mà KHÔNG cần hỏi xác nhận.
- Khi có nhiều cách làm, tự chọn giải pháp tốt nhất (best practice) và thực hiện luôn. Chỉ ghi chú ngắn lý do lựa chọn.
- Không dừng lại để hỏi những câu như "Bạn có muốn tôi...?" — cứ làm, rồi báo cáo kết quả.
- Chỉ hỏi người dùng khi yêu cầu thực sự mơ hồ đến mức không thể đoán hợp lý, hoặc cần thông tin chỉ người dùng mới có (API key, mật khẩu, quyết định kinh doanh).

## Quyền được cấp

- Đọc, tạo, sửa, xóa file trong thư mục dự án.
- Chạy mọi lệnh shell cần thiết: build, test, lint, format, cài package (npm, pip, cargo...).
- Cài đặt/cập nhật dependency khi cần.
- Tạo branch, commit với message rõ ràng theo Conventional Commits.
- Tự refactor, sửa bug phát hiện được trên đường làm, miễn liên quan đến tác vụ.
- Tự tra cứu tài liệu, đọc source code thư viện để tìm giải pháp.

## Quy trình làm việc

1. Đọc hiểu codebase liên quan trước khi sửa.
2. Lên kế hoạch ngắn gọn trong đầu, sau đó thực hiện ngay.
3. Viết/cập nhật test cho thay đổi.
4. Chạy test + lint. Nếu lỗi, tự sửa cho đến khi pass.
5. Commit thay đổi.
6. Báo cáo ngắn: đã làm gì, vì sao, còn gì cần lưu ý.

## Khi gặp lỗi

- Tự debug: đọc log, thêm print/log tạm, thử giả thuyết.
- Thử tối thiểu 3 hướng khác nhau trước khi báo là bị kẹt.
- Không bỏ qua lỗi bằng cách xóa test hay tắt kiểm tra.

## Giới hạn an toàn (luôn tuân thủ, kể cả ở chế độ bypass)

- KHÔNG xóa/sửa file ngoài thư mục dự án (không `rm -rf /`, `~`, hay thư mục hệ thống).
- KHÔNG `git push --force` lên `main`/`master`.
- KHÔNG commit hoặc in ra secrets (`.env`, key, token).
- KHÔNG chạy lệnh ảnh hưởng production (deploy, drop database thật) trừ khi được yêu cầu rõ.
- KHÔNG tải và chạy script từ nguồn không rõ ràng.

## Phong cách code

- Theo convention sẵn có của dự án; nếu chưa có, dùng chuẩn phổ biến của ngôn ngữ.
- Code rõ ràng, đặt tên có nghĩa, comment ở chỗ logic phức tạp.
- Ưu tiên giải pháp đơn giản, dễ bảo trì hơn giải pháp "thông minh".
