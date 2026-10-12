# 安卓手机部署（Termux）

用一部安卓手机当服务器。适合临时、小范围使用：活动现场开手机热点让大家连上来聊天，或者手边没有电脑。不需要 root。

## 安装

1. 安装 Termux：从 [F-Droid](https://f-droid.org/packages/com.termux/) 或 [GitHub](https://github.com/termux/termux-app/releases) 下载。**不要用 Google Play 上的旧版本。**
   要开机自启的话，再从同一个地方装 **Termux:Boot**，装好后打开一次。
2. 打开 Termux，运行：

   ```sh
   curl -fsSL https://raw.githubusercontent.com/Freecode100Year/private-talk/main/deploy/termux/install.sh | sh
   ```

   会安装 Node.js、下载本项目，并设置好开机自启脚本。
3. 安卓设置 → 应用 → Termux → 电池 → 选“不受限制”。否则锁屏后系统会把它停掉。

## 模式一：局域网（不需要互联网）

```sh
~/private-talk/deploy/termux/run.sh lan
```

- 手机连着 Wi-Fi：同一 Wi-Fi 里的人打开屏幕上列出的地址。
- 手机开热点：别人连上这个热点后打开地址。热点地址如果没有列出来，到“设置 → 关于手机 → 状态信息”或热点设置里看 IP，然后：
  `LAN_NAMES=192.168.43.1 ~/private-talk/deploy/termux/run.sh lan`
- 证书提示与安装 CA 的方法见 [docs/lan.md](lan.md)；CA 文件在 `~/private-talk/lan-certs/ca.crt`。

## 模式二：公网（Cloudflare Tunnel）

手机一般没有公网 IP，用 Cloudflare Tunnel 对外提供 HTTPS 网址：

1. Cloudflare 后台 → Zero Trust → Networks → Tunnels → 创建隧道（cloudflared），复制 token。
2. 隧道的 Public Hostname 里添加你的域名，服务填 `http://localhost:8080`。
3. 在 Termux 里：

   ```sh
   echo '你的token' > ~/.private-talk-tunnel && chmod 600 ~/.private-talk-tunnel
   ~/private-talk/deploy/termux/run.sh tunnel
   ```

Tailscale Funnel 在安卓上的情况见 [docs/tailscale.md](tailscale.md)。

## 开机自启

装了 Termux:Boot 后，手机重启会自动按 `~/.private-talk-mode` 里写的模式启动（默认 `lan`）：

```sh
echo tunnel > ~/.private-talk-mode
```

## 需要知道的

- 手机锁屏、切换网络时连接会断几秒，聊天页面会自动重连，2 分钟内回来还是原来的编号。
- 很耗电，接着充电器用。长期 24 小时使用请用电脑、NAS 或 VPS。
- 更新：`cd ~/private-talk && git pull && npm ci --omit=dev`。
- 本项目没有在每种安卓机型上实测过；遇到问题请提 Issue，附上 Termux 里的报错。
