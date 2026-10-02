# Chạy Bom Tấn trên Oracle Cloud Free (Singapore)

Từ Việt Nam, Render luôn có ping khoảng 100ms: traffic đi qua Cloudflare Hong Kong rồi mới tới Singapore. VM Oracle ở Singapore có IP đi thẳng, ping thường 30–50ms.

## 1. Tạo tài khoản

- Đăng ký tại https://signup.cloud.oracle.com (cần thẻ để xác minh, không bị trừ tiền).
- **Home Region chọn `Singapore`.** Tài nguyên Always Free chỉ có ở home region, và không đổi được về sau.
- Nên nâng lên **Pay As You Go** (vẫn free nếu dùng trong hạn mức Always Free). Tài khoản chỉ Free sẽ bị Oracle thu hồi VM nếu máy "rảnh" 7 ngày liền (CPU dưới 20%), mà server game thì phần lớn thời gian là rảnh.

## 2. Tạo VM

Compute → Instances → Create instance:

- **Image:** Ubuntu 24.04 (hoặc 22.04).
- **Shape:** `VM.Standard.A1.Flex` (ARM), 1–2 OCPU, 6–12 GB RAM.
  - Nếu báo *Out of capacity*: thử lại sau vài giờ, hoặc đổi Availability Domain.
  - Phương án cuối: `VM.Standard.E2.1.Micro` (yếu hơn nhưng vẫn ổn cho vài phòng).
- **SSH key:** tải key về hoặc dán public key của bạn (`~/.ssh/id_ed25519.pub`).
- **Public IP:** bật *Assign a public IPv4 address*.

## 3. Mở port 80 và 443

Instance → Subnet → Security List → *Add Ingress Rules*, thêm 2 rule:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

Firewall bên trong VM thì script tự mở.

## 4. Cài đặt

```bash
ssh ubuntu@<IP-của-VM>
curl -fsSLO https://raw.githubusercontent.com/Th1nh2411/bom-tan/main/deploy/oracle/setup.sh
sudo bash setup.sh
```

Script cài Node 22, Redis (giữ bảng xếp hạng khi khởi động lại) và Caddy (tự lo HTTPS), sau đó chạy game bằng systemd. Khi xong, script in ra link, ví dụ `https://152-69-1-2.sslip.io`. Domain `sslip.io` này dùng được ngay, không cần mua.

Các biến tùy chọn, truyền vào trước `bash setup.sh`:

```bash
sudo DOMAIN=bomtan.duckdns.org \
     GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com \
     SESSION_SECRET=<giá trị trên Render> \
     bash setup.sh
```

- `DOMAIN`: domain riêng. Trỏ record **A** về IP của VM trước khi chạy script. Nếu DNS quản lý trên Cloudflare thì để *DNS only* (mây xám), vì bật proxy thì traffic lại vòng qua Hong Kong.
- `GOOGLE_CLIENT_ID`: bật đăng nhập Google. Nhớ thêm `https://<DOMAIN>` vào *Authorized JavaScript origins* của OAuth client.
- `SESSION_SECRET`: copy từ Render để người chơi không bị đăng xuất. Bỏ trống thì script tự tạo.

## 5. Cập nhật code mới

Push lên `main` rồi chạy lại script trên VM:

```bash
sudo bash setup.sh
```

Lần chạy lại chỉ kéo code mới và khởi động lại app. Secret và các cài đặt cũ được giữ nguyên.

## Lệnh hay dùng

```bash
journalctl -u bom-tan -f        # xem log
sudo systemctl restart bom-tan  # khởi động lại
sudo nano /etc/bom-tan.env      # sửa biến môi trường (xong thì restart)
```
