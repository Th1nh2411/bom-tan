#!/usr/bin/env bash
# One-shot setup of Bom Tấn on an Oracle Cloud "Always Free" Ubuntu VM (ARM or AMD).
# Installs Node 22, Redis (keeps the leaderboard across restarts) and Caddy (HTTPS + WebSocket proxy),
# then runs the game as a systemd service. Safe to run again: it updates instead of reinstalling.
#
# Usage on the VM:
#   curl -fsSLO https://raw.githubusercontent.com/Th1nh2411/bom-tan/main/deploy/oracle/setup.sh
#   sudo DOMAIN=bomtan.duckdns.org GOOGLE_CLIENT_ID=... SESSION_SECRET=... bash setup.sh
#
# Every variable is optional:
#   DOMAIN            defaults to <public-ip>.sslip.io (works at once, no DNS needed)
#   GOOGLE_CLIENT_ID  Google sign-in; leave empty to turn it off
#   SESSION_SECRET    copy Render's value to keep players logged in; generated if empty
#   REPO / BRANCH     where the code comes from (default: this repo, main)
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo" >&2; exit 1; }

REPO=${REPO:-https://github.com/Th1nh2411/bom-tan.git}
BRANCH=${BRANCH:-main}
APP_DIR=/opt/bom-tan
ENV_FILE=/etc/bom-tan.env
APP_USER=bomtan
PORT=3000

export DEBIAN_FRONTEND=noninteractive

echo "==> Packages"
apt-get update -q
apt-get install -yq ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https redis-server iptables-persistent

# Node 22 from NodeSource's apt repo (Ubuntu's own nodejs is too old: the server needs >= 20.12)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -yq nodejs
fi

# Caddy from its official apt repo
if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -yq caddy
fi

echo "==> Firewall"
# Oracle's Ubuntu images ship iptables rules that reject everything but SSH; open 80/443 before that REJECT
for p in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null; then
    reject=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')
    iptables -I INPUT "${reject:-1}" -p tcp --dport "$p" -m state --state NEW -j ACCEPT
  fi
done
netfilter-persistent save

echo "==> Code"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  # the checkout belongs to $APP_USER; tell git that root may update it
  git -c safe.directory="$APP_DIR" -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -c safe.directory="$APP_DIR" -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Settings"
if [ -z "${DOMAIN:-}" ]; then
  IP=$(curl -fsS https://api.ipify.org)
  DOMAIN="${IP//./-}.sslip.io"
fi
# keep an existing secret on re-runs so sessions survive
OLD_SECRET=$(grep -s '^SESSION_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)
SESSION_SECRET=${SESSION_SECRET:-${OLD_SECRET:-$(openssl rand -hex 32)}}
OLD_CLIENT=$(grep -s '^GOOGLE_CLIENT_ID=' "$ENV_FILE" | cut -d= -f2- || true)
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-$OLD_CLIENT}
umask 077
cat > "$ENV_FILE" <<EOF
PORT=$PORT
NODE_ENV=production
REDIS_URL=redis://127.0.0.1:6379
SESSION_SECRET=$SESSION_SECRET
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
EOF
umask 022

cat > /etc/systemd/system/bom-tan.service <<EOF
[Unit]
Description=Bom Tan game server
After=network-online.target redis-server.service
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# Caddy gets a Let's Encrypt certificate for DOMAIN and proxies WebSockets as-is
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF

echo "==> Start"
systemctl daemon-reload
systemctl enable -q --now redis-server
systemctl enable -q bom-tan
systemctl restart bom-tan
systemctl reload caddy 2>/dev/null || systemctl restart caddy

sleep 2
if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null; then
  echo
  echo "Done: https://$DOMAIN"
  echo "Logs: journalctl -u bom-tan -f"
  [ -n "$GOOGLE_CLIENT_ID" ] && echo "Google sign-in: add https://$DOMAIN to the OAuth client's Authorized JavaScript origins"
else
  echo "Server did not answer on /healthz, check: journalctl -u bom-tan -n 50" >&2
  exit 1
fi
