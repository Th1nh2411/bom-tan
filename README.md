# Bom Tấn

Game đặt bom nhiều người chơi trên trình duyệt, tối đa 8 người mỗi ván. Giao diện giả làm cửa sổ VS Code để chơi kín đáo.

**Chế độ đối kháng:**
- Solo.
- Đội: cứu được đồng đội bị hạ.
- Zombie: một người bắt đầu là zombie và lây cho người khác.
- Săn boss: một người làm boss nhiều mạng, gọi được quái; cả nhóm săn nó trong 2 phút.

**Chế độ hợp tác (đánh quái):**
- Sinh tồn: quái kéo đến theo đợt, cứ 5 đợt có boss; giữa các đợt mua đồ bằng xu.
- Đánh boss: 4 boss 2×2 (Vua Bom, Rồng Lửa, Người Đá, Hồn Ma), mỗi con một kiểu đánh, có báo trước; còn nửa máu thì nổi giận.
- Đi ải: 10 ải, ải 5 và 10 là boss; diệt hết quái rồi tìm cửa ra giấu dưới thùng.
- 5 loại quái: nhầy, dơi, ma (xuyên thùng), quỷ con (né bom), giáp sắt (3 máu).

**Sự kiện giữa ván** (chủ phòng bật/tắt): tắt đèn, mặt băng (buông phím vẫn trượt), bom max tầm. Mỗi 20–30 giây, báo trước 3 giây, kéo dài 10 giây.

**Vật phẩm đổi hình vụ nổ:** lửa chéo (bay qua cột), nổ vuông, lửa xuyên thùng. **Kiểu bom** chọn trong menu Bạn: bom cổ điển, bóng nước, pháo hoa, bí ngô (lửa đổi theo).

**Boss** có 3 đòn mỗi con, đánh thành nhiều đợt có báo trước (mưa bom, vòng bom, hàng bom; phun lửa, lửa chéo, mưa thiên thạch; dậm đất, sóng chấn động, đá rơi; chữ thập, dịch chuyển áp sát, gọi ma); khi nổi giận đôi khi tung 2 đòn cùng lúc.

**Map:** Cổ điển, Đấu trường, Ngã tư, Bốn phòng, Pháo đài, hoặc Ngẫu nhiên; chủ phòng chọn trong sảnh. Đi ải có map riêng cho từng ải.

**Luật chơi:**
- Cổng dịch chuyển; lửa bom cũng đi xuyên qua cổng.
- 5 loại vật phẩm tốt: thêm bom, nổ xa, chạy nhanh, đá bom, khiên. Có thêm vật phẩm xấu 💀 gây lời nguyền và lây khi chạm.
- Vùng bo thu hẹp sau 1 phút.
- Người đã chết vẫn thả được bom.
- Mỗi ngày có một luật đặc biệt.
- Map to dần theo số người chơi. Mỗi ván, người chơi xuất hiện ở vị trí ngẫu nhiên.

**Ngoài ván chơi:**
- Thống kê cuối ván và bảng xếp hạng.
- 14 thành tích, mỗi thành tích mở khóa một chiếc mũ (5 thành tích của chế độ hợp tác và săn boss).
- Đăng nhập Google để giữ điểm khi đổi máy (tuỳ chọn).

## Cấu trúc

```
public/
  index.html        Khung trang
  css/style.css     Giao diện
  js/engine.js      Luật chơi, không dùng DOM (có test)
  js/pve.js         Quái, boss, đợt, ải, săn boss (chỉ server chạy; có test)
  js/common.js      Hằng số, hàm dùng chung
  js/sound.js       Âm thanh tổng hợp, không cần file
  js/input.js       Bàn phím, chuột, cảm ứng
  js/net.js         Kết nối WebSocket, trạng thái phòng
  js/game.js        Dự đoán vị trí, tạm dừng, chế độ 1 máy
  js/render.js      Vòng lặp chính, vẽ canvas
  js/progress.js    Thành tích, mũ, thông báo
  js/auth.js        Đăng nhập Google (tuỳ chọn)
  js/lobby.js       Sidebar: vào phòng, sảnh chờ, người chơi, phòng công khai
  js/ui.js          Overlay, danh sách người chơi, nút bấm
server.js           Phục vụ public/ và WebSocket ở /api/ws, kiểm tra sống ở /healthz
server/relay.js     Kết nối WebSocket, phòng, bảng xếp hạng
server/game.js      Chạy engine.js + pve.js trên server cho từng phòng
server/auth.js      Kiểm tra token Google, cấp phiên đăng nhập
test/               Test cho engine và relay (node --test)
render.yaml         Cấu hình deploy lên Render
deploy/oracle/      Script cài đặt lên VM Oracle Cloud Free
```

Các file trong `public/js/` là script thường, nạp theo thứ tự trong `index.html` và dùng chung phạm vi toàn cục. Không cần bước build.

## Cách hoạt động

- **Server chạy luật chơi.** Mỗi phòng có một ván chạy trên server (`server/game.js` dùng chung `public/js/engine.js` với trình duyệt), khoảng 30 lần/giây. Mỗi thao tác chỉ mất 1 vòng client ↔ server, và không phụ thuộc mạng của ai khác trong phòng.
- **Trình duyệt dự đoán vị trí.** Bạn thấy mình di chuyển ngay khi bấm phím; server kiểm tra vị trí gửi lên (không cho chạy nhanh hơn tốc độ, xuyên tường) và kéo về nếu lệch.
- **Chưa vào phòng thì ở sân tập.** Mở trang không có `#mã-phòng` là vào sân tập: tự đi lại, đặt bom để làm quen phím; sidebar có Chơi nhanh, Tạo phòng, nhập mã phòng và danh sách phòng công khai. Trong sảnh chờ cũng là sân tập riêng của mỗi người cho tới khi ván bắt đầu.
- **Sẵn sàng là vào chơi.** Trong sảnh chờ ai cũng bấm "Sẵn sàng"; khi tất cả (từ 2 người) đã sẵn sàng thì ván tự bắt đầu sau 3 giây. Ai tick "Tự sẵn sàng ván mới" thì hết ván được đánh dấu sẵn sàng luôn, nên cả phòng cùng tick là chơi liên tục.
- **Chủ phòng** chọn chế độ, bấm "Bắt đầu ngay" (không đợi ai), dừng ván, kick, và bật "Phòng công khai". Người đăng nhập vào phòng đầu tiên làm chủ phòng; chủ phòng rời đi thì người kế tiếp thay sau 1,5 giây, ván đang chơi vẫn tiếp tục.
- **Phòng công khai** hiện trong danh sách ở màn hình chính và sảnh chờ (`GET /api/rooms`). "Chơi nhanh" vào phòng công khai đông nhất còn chỗ; chưa có phòng nào thì mở công khai phòng hiện tại.
- **Server giữ trật tự phòng:**
  - Người bị kick bị ngắt kết nối và không vào lại được phòng đó.
  - Mỗi phòng tối đa 16 kết nối.
  - Mỗi kết nối gửi tối đa 240 tin/giây.
  - Server tự ghi kết quả ván vào bảng xếp hạng, người chơi không gửi điểm lên được.
- **Tiết kiệm băng thông:** server chỉ gửi phần thay đổi, chỉ nén gói lớn (gói nhỏ nén thì tốn CPU mà không được bao nhiêu), và thao tác điều khiển không bị chuyển cho người khác.
- **Chạy một instance.** Phòng nằm trong bộ nhớ của server, nên đừng bật nhiều instance (autoscale). 50 phòng × 8 người tốn khoảng 1 ms CPU mỗi tick.

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
- Ping từ Việt Nam khoảng 100ms trở lên: traffic đi qua Cloudflare Hong Kong rồi mới tới Singapore.

## Deploy lên Oracle Cloud Free (ping thấp hơn)

VM Singapore miễn phí có IP đi thẳng, ping từ Việt Nam thường 30–50ms. Một lệnh cài Node, Redis, HTTPS và chạy game: xem [deploy/oracle/README.md](deploy/oracle/README.md).

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

- **Test PvE** (`test/pve.test.js`): quái chết và trả xu, quái chạm làm hạ gục, đợt và cửa hàng, boss chỉ mất máu vì bom người chơi và nổi giận, 4 kiểu tấn công có báo trước, cửa ra và qua ải, săn boss.
- **Test engine** (`test/engine.test.js`): kích thước map, vị trí spawn, vụ nổ, lửa qua cổng, khiên, rơi đồ khi chết, vùng bo, bom của người đã chết, thống kê cuối ván.
- **Test relay** (`test/relay.test.js`): server chạy ván, sẵn sàng và tự bắt đầu, phòng công khai, chọn chủ phòng và chuyển chủ phòng, chỉ chủ phòng ra lệnh, điều khiển không bị chuyển cho người khác, kick, ghi bảng xếp hạng, giới hạn phòng, chống spam.
- **Test đăng nhập** (`test/auth.test.js`): kiểm tra token Google (dùng khóa giả), phiên đăng nhập, chống giả mạo mã người chơi.

## Những điều cần biết

- **Phòng chơi nằm trong đường link.** Phần sau dấu `#` là mã phòng. Mở trang không có mã là vào sân tập, chưa vào phòng nào.
- **Bảng xếp hạng có thêm kỷ lục hợp tác:** đợt xa nhất (Sinh tồn), ải xa nhất (Đi ải) và số boss đã hạ.
- **Ping phụ thuộc đường đi tới server.** Render (Singapore, qua proxy Cloudflare Hong Kong): từ Việt Nam khoảng 100 ms. VM Oracle Singapore có IP đi thẳng: khoảng 30–50 ms. Gói miễn phí của Render dùng CPU chia sẻ và ngủ khi không có ai.
- **Bảng xếp hạng dùng chung cho mọi phòng**, và nhận diện người chơi theo trình duyệt, không cần đăng nhập. Đổi trình duyệt thì được tính là người mới.
- **Sau khi cập nhật code, mọi người phải tải lại trang.** Trình duyệt và server cần cùng phiên bản.
- **Phím tắt:**
  - `Esc`: tạm dừng cả phòng và che màn hình bằng một file code giả.
  - `` ` ``: chơi tiếp.
