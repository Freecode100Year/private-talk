# Tailscale 手册

**适合**：已经在用 Tailscale（或愿意用）的人。

| 模式 | 谁能打开 | 典型用途 |
| :--- | :--- | :--- |
| **私人内网（Serve）** | 只有加入你 Tailscale 网络的设备 | 家人、团队跨城市聊天，外人连网址都打不开 |
| **公网（Funnel）** | 任何拿到网址的人 | 没有域名、不想开端口，又想公开给别人用 |

两种模式都自带 HTTPS 证书，不需要公网 IP。

## 需要下载什么

| 下载 | 说明 |
| :--- | :--- |
| [Tailscale](https://tailscale.com/download) | 当服务器的电脑和每台要访问的设备都要装（公网 Funnel 模式下访问者不用装） |
| 离线安装包（自带 Node.js） | 当服务器的电脑：[Windows](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-win-x64.zip) · [Mac Apple 芯片](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-darwin-arm64.tar.gz) · [Mac Intel](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-darwin-x64.tar.gz) · [Linux x64](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-x64.tar.gz) · [Linux ARM](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-arm64.tar.gz) |
| 或：Docker | 用 Docker 方式时不用下载离线包，镜像 `tailscale/tailscale` 和 `private-talk` 启动时自动下载；源码 [main.zip](https://github.com/Freecode100Year/private-talk/archive/refs/heads/main.zip) |

## 1. 先看隐私

- 网址形如 `https://机器名.tailnet名.ts.net`，会出现在每个房间链接里。旧的 tailnet 名可能含账号名或邮箱前缀：**管理后台 → DNS → Rename tailnet，换成随机名字**。
- 证书是公开签发的，机器名会出现在公开的证书透明度日志里，机器名不要用真名。
- Funnel 的流量经过 Tailscale 的服务器。聊天内容是加密的，Tailscale 看不到，但知道是你的账号在提供这个服务。
- 需要更强的匿名性，请用 [Cloudflare 手册](cloudflare.md)或 [VPS 手册](vps.md)。

## 2. 准备

1. 在要当服务器的电脑上安装 Tailscale 并登录。
2. 管理后台 → DNS：打开 MagicDNS 和 HTTPS Certificates。
3. 用公网模式还要：管理后台 → Access controls → Funnel → Add Funnel to policy。

## 3. 运行

电脑上需要 Node.js 22+（或用[局域网手册](lan.md)里的离线包，把下面的 `node` 换成包里的 `node/bin/node` 或 `node\node.exe`）：

```sh
git clone https://github.com/Freecode100Year/private-talk.git
cd private-talk && npm ci --omit=dev
HOST=127.0.0.1 TRUST_PROXY=1 node server/server.mjs
```

另开一个终端：

```sh
tailscale serve --bg 8080       # 私人内网
tailscale funnel --bg 8080      # 或者：公网
tailscale serve status          # 显示网址
```

关闭：`tailscale serve reset` / `tailscale funnel reset`。

**Docker**：

```sh
curl -fsSL https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-compose.tar.gz | tar -xz
cd private-talk-docker
printf 'COMPOSE_FILE=docker-compose.tailscale.yml\nTS_AUTHKEY=tskey-auth-...\nTS_MODE=private\n' > .env && chmod 600 .env
docker compose up -d          # 以后升级：./pt upgrade（.env 里加 PT_URL=https://你的ts.net网址 后，./pt status 会做聊天自检）
# 公网把 TS_MODE 改成 funnel
```

认证密钥在管理后台 Settings → Keys 生成。

## 4. 确认部署成功

1. `tailscale serve status` 显示网址，并且指向 `http://127.0.0.1:8080`。
2. 私人内网模式：在另一台已登录同一个 Tailscale 账号（或被邀请）的设备上打开网址，看到首页。
   公网模式：用手机流量（不装 Tailscale）打开网址，看到首页。
3. 两台设备用同一个暗号进房间，互发消息能收到。

## 5. 发给大家

- 私人内网：对方要先装 Tailscale、加入你的网络（管理后台邀请），再打开网址。
- 公网：直接把网址和[用户使用手册](user.md)发给对方。

## 6. 手机

安卓、iPhone 上的 Tailscale App 可以加入网络、打开网址，但**不能在手机上开 Serve 或 Funnel**。手机当服务器的办法见[安卓手机手册](android.md)。

## 7. 卸载

`tailscale serve reset`（或 `tailscale funnel reset`），停止 `node server/server.mjs`，删除程序目录。Docker：在 `private-talk-docker` 文件夹运行 `docker compose down -v`，再到 Tailscale 管理后台删除这台机器。

## 8. 出问题

| 现象 | 做法 |
| :--- | :--- |
| `tailscale funnel` 提示没有权限 | 管理后台没有把 Funnel 加进访问策略，或没开 HTTPS Certificates |
| 第一次打开要等几秒 | 首次访问时 Tailscale 在申请证书，稍等即可 |
| 别人打不开私人内网网址 | 对方没有加入你的 Tailscale 网络 |

详细技术说明见 [docs/tailscale.md](../tailscale.md)。
