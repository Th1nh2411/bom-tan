# Bom Tấn

Game đặt bom nhiều người chơi trên trình duyệt, tối đa 8 người mỗi ván. Giao diện giả làm cửa sổ VS Code để chơi kín đáo.

**Chế độ chơi:**
- Solo.
- Đội: cứu được đồng đội bị hạ.
- Zombie: một người bắt đầu là zombie và lây cho người khác.

**Luật chơi:**
- Cổng dịch chuyển; lửa bom cũng đi xuyên qua cổng.
- 5 loại vật phẩm tốt: thêm bom, nổ xa, chạy nhanh, đá bom, khiên. Có thêm vật phẩm xấu 💀 gây lời nguyền và lây khi chạm.
- Vùng bo thu hẹp sau 1 phút.
- Người đã chết vẫn thả được bom.
- Mỗi ngày có một luật đặc biệt.
- Map to dần theo số người chơi. Mỗi ván, người chơi xuất hiện ở vị trí ngẫu nhiên.

**Ngoài ván chơi:**
- Thống kê cuối ván và bảng xếp hạng.
- 9 thành tích, mỗi thành tích mở khóa một chiếc mũ.
- Đăng nhập Google để giữ điểm khi đổi máy (tuỳ chọn).

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
  js/progress.js    Thành tích, mũ, thông báo
  js/auth.js        Đăng nhập Google (tuỳ chọn)
  js/ui.js          Overlay, danh sách người chơi, nút bấm
server.js           Phục vụ public/ và WebSocket ở /api/ws, kiểm tra sống ở /healthz
server/relay.js     Máy chủ chuyển tin giữa những người cùng phòng
server/auth.js      Kiểm tra token Google, cấp phiên đăng nhập
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

## Đăng nhập Google (tuỳ chọn)

Chưa cấu hình thì nút đăng nhập tự ẩn, game vẫn chạy bình thường.

1. Vào console.cloud.google.com, tạo một project.
2. Vào **APIs & Services → OAuth consent screen**, chọn **External**, điền tên app và email, rồi lưu.
3. Vào **Credentials → Create credentials → OAuth client ID**, chọn loại **Web application**.
4. Ở **Authorized JavaScript origins**, thêm `http://localhost:3000` và địa chỉ Render, ví dụ `https://bom-tan-xxxx.onrender.com`. Không cần redirect URI.
5. Copy **Client ID** vào biến môi trường `GOOGLE_CLIENT_ID`:
   - Trên máy: tạo file `.env` ở thư mục gốc, ghi dòng `GOOGLE_CLIENT_ID=...`. Server tự đọc file này khi khởi động, và file đã được `.gitignore` bỏ qua.
   - Trên Render: đặt trong **Environment**.

Cần biết:
- `SESSION_SECRET` dùng để ký phiên đăng nhập, giữ 30 ngày. Render tự tạo biến này qua `render.yaml`. Nếu không đặt, người chơi phải đăng nhập lại mỗi khi server khởi động lại.
- Google chỉ cho đăng nhập trên `localhost` hoặc `https`. Chơi qua LAN bằng `http://192.168...` thì không đăng nhập được, nhưng vẫn chơi bình thường.
- Server tự kiểm tra chữ ký token với khóa công khai của Google. Người chơi khác chỉ thấy một mã đã mã hóa, không thấy email hay tài khoản Google.

## Test

```bash
npm test
```

- **Test engine** (`test/engine.test.js`): kích thước map, vị trí spawn, vụ nổ, lửa qua cổng, khiên, rơi đồ khi chết, vùng bo, bom của người đã chết, thống kê cuối ván.
- **Test relay** (`test/relay.test.js`): một chủ phòng, kick, giới hạn phòng, chống spam, chuyển tin điều khiển tới chủ phòng, bảng xếp hạng.
- **Test đăng nhập** (`test/auth.test.js`): kiểm tra token Google (dùng khóa giả), phiên đăng nhập, chống giả mạo mã người chơi.

## Những điều cần biết

- **Phòng chơi nằm trong đường link.** Phần sau dấu `#` là mã phòng. Mở trang không có mã thì game tự tạo phòng mới.
- **Chủ phòng quyết định độ lag của cả phòng.** Nên để người có mạng tốt nhất làm chủ phòng. Chủ phòng chuyển tab thì game vẫn chạy.
- **Bảng xếp hạng dùng chung cho mọi phòng**, và nhận diện người chơi theo trình duyệt, không cần đăng nhập. Đổi trình duyệt thì được tính là người mới.
- **Sau khi cập nhật code, mọi người phải tải lại trang.** Trình duyệt và server cần cùng phiên bản.
- **Phím tắt:**
  - `Esc`: tạm dừng cả phòng và che màn hình bằng một file code giả.
  - `` ` ``: chơi tiếp.
