# Tailscale：Funnel（公网）与 Serve（私人内网）

[Tailscale](https://tailscale.com/) 把你的设备连成一个私人网络（tailnet），并自动提供 `https://机器名.tailnet名.ts.net` 的 HTTPS 证书。

| 模式 | 谁能打开 | 用途 |
| :--- | :--- | :--- |
| **Serve（private）** | 只有加入你 tailnet 的设备 | 家人、团队之间的私人内网聊天，跨城市也行 |
| **Funnel** | 任何拿到网址的人 | 不想买域名、不想开端口的公网部署 |

两种都支持聊天需要的 WebSocket，都不需要公网 IP 或开放端口。

## 先看隐私

- 网址里的 `tailnet名.ts.net` 会出现在每个房间链接里。旧的 tailnet 名可能带有你的账号名或邮箱前缀。**公开前到管理后台 DNS 页面把 tailnet 名换成随机名字**（“Rename tailnet”选随机生成的）。
- Funnel 的流量经过 Tailscale 的中继服务器。内容是浏览器端加密的，Tailscale 看不到聊天内容，但知道是你的账号在提供这个服务、以及有多少访问。
- 两种模式的 HTTPS 证书都是公开签发的，`机器名.tailnet名.ts.net` 会出现在公开的证书透明度日志里，别人能查到这个名字存在（private 模式下也查得到名字，但打不开）。机器名不要用真名。
- 需要更强的匿名性时，用 Cloudflare 一键部署或境外 VPS 更合适。

## 电脑 / Linux 服务器（不用 Docker）

```sh
# 安装并登录 Tailscale 后：
npm ci --omit=dev
HOST=127.0.0.1 TRUST_PROXY=1 npm start &        # 只监听本机，由 Tailscale 转发

tailscale serve --bg 8080      # 私人内网：只有 tailnet 设备能打开
# 或
tailscale funnel --bg 8080     # 公网：任何人能打开
```

用 `tailscale serve status` 查看网址；`tailscale funnel reset` / `tailscale serve reset` 关闭。
第一次使用 Funnel 时，命令会给出一个链接，按提示在管理后台允许本机使用 Funnel，并打开 MagicDNS 和 HTTPS 证书。

## Docker

```sh
TS_AUTHKEY=tskey-auth-... TS_MODE=private docker compose -f docker-compose.tailscale.yml up -d
# 公网：TS_MODE=funnel
```

- 认证密钥在管理后台 Settings → Keys 生成。
- 机器名默认 `private-talk`，可用 `TS_HOSTNAME` 改。网址：`https://private-talk.<tailnet名>.ts.net`。
- Tailscale 的配置在 `deploy/tailscale/private.json` 和 `funnel.json`。

## 安卓手机

安卓版 Tailscale App 可以加入 tailnet，但 Serve 和 Funnel 官方只提供命令行用法，安卓 App 没有命令行，**目前无法在手机上开 Serve 或 Funnel**。手机当服务器时：

- 只在 tailnet 里用：在手机上按 [docs/android.md](android.md) 运行局域网模式（`run.sh lan`），手机开着 Tailscale App，tailnet 里的其他设备用手机的 Tailscale 地址（`100.x.y.z`）打开：
  `LAN_NAMES=100.x.y.z ~/private-talk/deploy/termux/run.sh lan`
  证书提示的处理同 [docs/lan.md](lan.md)。
- 要公网访问：用 [docs/android.md](android.md) 的 Cloudflare Tunnel 模式。

## 需要知道的

- 设置了 `TRUST_PROXY=1`，限速按 Tailscale 转发过来的访客地址计算。
- Tailscale 免费版对 Funnel 有带宽限制，聊天只传文字，小范围使用足够。
- 这份说明的 Docker 配置在本项目的测试环境中只校验过格式，没有实际登录 Tailscale 测试；遇到问题请提 Issue。
