#!/data/data/com.termux/files/usr/bin/sh
# Start 隐匿对话 on the phone.
#   run.sh lan      HTTPS on the local network (Wi-Fi or the phone's hotspot)
#   run.sh tunnel   public HTTPS through Cloudflare Tunnel; needs TUNNEL_TOKEN
#                   (or ~/.private-talk-tunnel holding the token). In the
#                   tunnel's Public Hostname, point the service to
#                   http://localhost:8080
# Android stops background apps; the wake lock keeps Termux running. Also set
# Termux to "unrestricted" battery use in Android settings.
set -e
cd "$HOME/private-talk"
termux-wake-lock 2>/dev/null || true
case "${1:-lan}" in
  lan)
    exec npm run lan
    ;;
  tunnel)
    command -v cloudflared >/dev/null || pkg install -y cloudflared
    TOKEN="${TUNNEL_TOKEN:-$(cat "$HOME/.private-talk-tunnel" 2>/dev/null)}"
    [ -n "$TOKEN" ] || { echo "需要 TUNNEL_TOKEN（Cloudflare Zero Trust → Tunnels 里复制）"; exit 1; }
    HOST=127.0.0.1 PORT=8080 TRUST_PROXY=1 node server/server.mjs &
    trap 'kill $! 2>/dev/null' EXIT INT TERM
    TUNNEL_TOKEN="$TOKEN" cloudflared tunnel --no-autoupdate run
    ;;
  *)
    echo "用法：run.sh lan | tunnel"; exit 1
    ;;
esac
