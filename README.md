# Bom Tấn

Game đặt bom nhiều người chơi trên trình duyệt, tối đa 8 người mỗi ván, có chế độ đội, cứu đồng đội, đá bom, cổng dịch chuyển và bảng xếp hạng.

## Cấu trúc

```
public/index.html   Toàn bộ game (giao diện + luật chơi, chạy trong trình duyệt)
api/ws.js           Máy chủ WebSocket, chuyển tin giữa những người cùng phòng
dev.js              Máy chủ chạy thử trên máy bạn
vercel.json         Cấu hình Vercel
```

Luật chơi chạy trong trình duyệt của người làm chủ phòng. Máy chủ chỉ chuyển tin, nên rất nhẹ.

## Chạy thử trên máy

Cần Node.js 20 trở lên.

```bash
npm install
npm run dev
```

Mở `http://localhost:3000` ở hai tab trình duyệt. Hai tab cùng đường link (cùng phần `#mã-phòng`) sẽ vào chung một phòng.

## Deploy lên Vercel

1. Đưa thư mục này lên một repo GitHub.
2. Vào vercel.com, chọn **Add New → Project**, chọn repo vừa tạo. Framework Preset để **Other**, không cần sửa gì khác, bấm **Deploy**.
3. Thêm Redis (rất nên làm, xem giải thích bên dưới):
   - Trong project, mở tab **Storage** (hoặc **Marketplace**), chọn một nhà cung cấp Redis, ví dụ **Upstash for Redis**, gói miễn phí.
   - Kết nối nó với project. Vercel sẽ tự thêm biến môi trường `REDIS_URL` (hoặc `KV_URL`, code đọc được cả hai).
   - Vào **Deployments**, bấm **Redeploy** để bản mới nhận biến môi trường.
4. Mở link Vercel, bấm **Làm chủ phòng**, rồi bấm **Sao chép link mời** và gửi cho cả nhóm.

Nếu mở trang mà thanh trạng thái cứ báo "đang kết nối lại…", hãy vào **Settings → Functions** của project, kiểm tra **Fluid compute** đang bật, và xem tài khoản đã được bật tính năng WebSockets (đang ở giai đoạn beta) chưa.

## Vì sao nên thêm Redis

Vercel có thể đưa người chơi của cùng một phòng vào các máy chủ khác nhau. Không có Redis, những người đó sẽ không thấy nhau. Có Redis, các máy chủ tự chuyển tin cho nhau, và chỉ dùng Redis khi phòng thật sự bị chia ra, nên tốn rất ít lượt gọi.

Redis cũng là nơi lưu bảng xếp hạng. Không có Redis, bảng xếp hạng chỉ nằm trong bộ nhớ và sẽ mất mỗi khi máy chủ khởi động lại.

## Những điều cần biết

- **Kết nối tự nối lại sau mỗi 5 phút.** Gói Hobby của Vercel giới hạn mỗi kết nối tối đa 5 phút. Game tự kết nối lại trong khoảng 1 giây và ván đang chơi vẫn tiếp tục, vì trạng thái ván nằm ở trình duyệt chủ phòng. Bạn có thể thấy khựng nhẹ lúc đó. Gói Pro cho phép tăng lên 800 giây bằng cách sửa `maxDuration` trong `vercel.json`.
- **Phòng chơi nằm trong đường link.** Phần sau dấu `#` là mã phòng. Mở trang không có mã thì game tự tạo phòng mới. Muốn đổi phòng, chỉ cần sửa mã trên thanh địa chỉ.
- **Bảng xếp hạng dùng chung cho mọi phòng** và nhận diện người chơi theo trình duyệt, không cần đăng nhập. Đổi trình duyệt hoặc xóa dữ liệu trang thì sẽ tính như người mới. Vì không có tài khoản, người rành kỹ thuật có thể gửi điểm giả, nên bảng này hợp để chơi vui với bạn bè hơn là thi đấu nghiêm túc.
- **Vùng máy chủ** mặc định ở Mỹ (`iad1`). Nếu nhóm bạn ở Việt Nam, vào **Settings → Functions → Function Region** và chọn Singapore (`sin1`) để giảm độ trễ đáng kể. Nên chọn Redis cùng khu vực.
