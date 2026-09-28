# Bom Tấn

Game đặt bom nhiều người chơi trên trình duyệt, tối đa 8 người mỗi ván. Giao diện giả làm cửa sổ VS Code để chơi kín đáo.

Có chế độ solo và chế độ đội (cứu đồng đội), cổng dịch chuyển (lửa bom cũng đi xuyên), 5 loại vật phẩm (thêm bom, nổ xa, chạy nhanh, đá bom, khiên), vùng bo thu hẹp sau 1 phút, người đã chết vẫn thả được bom, thống kê cuối ván và bảng xếp hạng. Map to dần theo số người chơi, và mỗi ván mọi người xuất hiện ở chỗ ngẫu nhiên.

## Cấu trúc

```
public/
  index.html        Khung trang
  css/style.css     Giao diện
  js/engine.js      Luật chơi, không dùng DOM (có test)
  js/common.js      Hằng số, hàm dùng chung
  js/sound.js       Âm thanh tổng hợp, không cần file
  js/input.js       Bàn phím, chuột, cảm ứng
  js/net.js         Kết nối WebSocket, trạng thái phòng
  js/game.js        Làm chủ phòng, dự đoán vị trí, tạm dừng
  js/render.js      Vòng lặp chính, vẽ canvas
  js/ui.js          Overlay, danh sách người chơi, nút bấm
server.js           Phục vụ public/ và WebSocket ở /api/ws, kiểm tra sống ở /healthz
server/relay.js     Máy chủ chuyển tin giữa những người cùng phòng
test/               Test cho engine và relay (node --test)
render.yaml         Cấu hình deploy lên Render
```

Các file trong `public/js/` là script thường, nạp theo thứ tự trong `index.html` và dùng chung phạm vi toàn cục. Không cần bước build.

## Cách hoạt động

- **Chủ phòng chạy luật chơi.** Trình duyệt của người làm chủ phòng tính toán ván đấu và gửi trạng thái cho mọi người. Server chỉ chuyển tin, nên rất nhẹ.
- **Server giữ trật tự phòng:**
  - Chỉ một người được làm chủ phòng; người bấm sau bị từ chối.
  - Người bị kick bị ngắt kết nối và không vào lại được khi chủ phòng đó còn đó.
  - Mỗi phòng tối đa 16 kết nối.
  - Mỗi kết nối gửi tối đa 240 tin/giây.
  - Chỉ chủ phòng được ghi kết quả vào bảng xếp hạng.
- **Tiết kiệm băng thông:**
  - Server nén dữ liệu.
  - Chỉ gửi phần thay đổi.
  - Thao tác điều khiển chỉ gửi tới chủ phòng.
  - Một ván 5 người tốn khoảng 4 KB/s.

## Chạy trên máy

Cần Node.js 20 trở lên.

```bash
npm install
npm start        # hoặc: npm run dev   (tự khởi động lại khi sửa server)
```

Mở `http://localhost:3000`. Hai tab cùng đường link (cùng phần `#mã-phòng`) sẽ vào chung một phòng.

**Chơi qua mạng LAN** (cùng WiFi, ping thấp nhất): mọi người mở `http://<IP-máy-bạn>:3000/#tenphong`. Xem IP trên macOS bằng `ipconfig getifaddr en0`. Lần đầu macOS hỏi có cho Node nhận kết nối không, chọn Allow.

**Cho người ở xa vào tạm thời:** `cloudflared tunnel --url http://localhost:3000` in ra một link công khai. Ping phụ thuộc điểm trung chuyển của Cloudflare, có thể cao hơn Render.

## Deploy lên Render

1. Đưa code lên GitHub.
2. Vào dashboard.render.com, chọn **New → Blueprint**, chọn repo, rồi bấm **Apply**. Render đọc `render.yaml`: gói miễn phí, server Singapore, kiểm tra sống qua `/healthz`.
3. Tuỳ chọn: tạo Redis miễn phí ở upstash.com, thêm biến môi trường `REDIS_URL` trong **Environment** của service. Có Redis thì bảng xếp hạng không bị mất khi server khởi động lại.

Giới hạn của gói miễn phí:
- Server ngủ sau 15 phút không có ai. Lần mở tiếp theo phải chờ khoảng 1 phút.
- Băng thông mỗi tháng có hạn mức. Xem trang giá của Render.

## Test

```bash
npm test
```

- **Test engine** (`test/engine.test.js`): kích thước map, vị trí spawn, vụ nổ, lửa qua cổng, khiên, rơi đồ khi chết, vùng bo, bom của người đã chết, thống kê cuối ván.
- **Test relay** (`test/relay.test.js`): một chủ phòng, kick, giới hạn phòng, chống spam, chuyển tin điều khiển tới chủ phòng, bảng xếp hạng.

## Những điều cần biết

- **Phòng chơi nằm trong đường link.** Phần sau dấu `#` là mã phòng. Mở trang không có mã thì game tự tạo phòng mới.
- **Chủ phòng quyết định độ lag của cả phòng.** Nên để người có mạng tốt nhất làm chủ phòng. Chủ phòng chuyển tab thì game vẫn chạy.
- **Bảng xếp hạng dùng chung cho mọi phòng**, và nhận diện người chơi theo trình duyệt, không cần đăng nhập. Đổi trình duyệt thì được tính là người mới.
- **Sau khi cập nhật code, mọi người phải tải lại trang.** Trình duyệt và server cần cùng phiên bản.
- **Phím tắt:**
  - `Esc`: tạm dừng cả phòng và che màn hình bằng một file code giả.
  - `` ` ``: chơi tiếp.
