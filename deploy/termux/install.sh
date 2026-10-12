#!/data/data/com.termux/files/usr/bin/sh
# 隐匿对话 on an Android phone, in Termux (from F-Droid or GitHub, not the
# old Play Store build). Installs Node.js and the project, and sets up
# Termux:Boot to start it after a reboot.
#   curl -fsSL https://raw.githubusercontent.com/Freecode100Year/private-talk/main/deploy/termux/install.sh | sh
set -e
pkg update -y
pkg install -y nodejs git
if [ -d "$HOME/private-talk/.git" ]; then
  git -C "$HOME/private-talk" pull --ff-only
else
  git clone --depth 1 https://github.com/Freecode100Year/private-talk "$HOME/private-talk"
fi
cd "$HOME/private-talk"
npm ci --omit=dev --ignore-scripts
chmod +x deploy/termux/run.sh
# Termux:Boot runs the scripts in ~/.termux/boot after the phone starts.
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/private-talk" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/sh
exec "$HOME/private-talk/deploy/termux/run.sh" "$(cat "$HOME/.private-talk-mode" 2>/dev/null || echo lan)"
BOOT
chmod +x "$HOME/.termux/boot/private-talk"
echo
echo "安装完成。启动："
echo "  ~/private-talk/deploy/termux/run.sh lan      # 局域网：同一 Wi-Fi 或连手机热点的人"
echo "  TUNNEL_TOKEN=... ~/private-talk/deploy/termux/run.sh tunnel   # 公网：Cloudflare Tunnel"
echo "开机自启需另装 Termux:Boot 并打开一次；默认模式写在 ~/.private-talk-mode（lan 或 tunnel）。"
