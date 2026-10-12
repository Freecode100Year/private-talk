# VPS 手册（境外服务器 + 域名）

**适合**：有一台境外 VPS 和一个域名，想自己完全掌控服务器的人。
**结果**：`https://chat.你的域名`，证书自动申请和续期。
**费用**：VPS 和域名的费用。程序本身很省资源，最小配置（1 核 512MB）就够几十个房间。

## 1. 准备

- 一台境外 Linux VPS（Debian / Ubuntu 最省事），能用 SSH 登录。
  中国大陆的服务器开网站需要备案，这类站点也不适合放在境内。
- 一个域名，在 DNS 里加一条 A 记录（有 IPv6 再加 AAAA）：`chat.你的域名` → VPS 的 IP。
- VPS 防火墙开放 80 和 443 端口。

## 2. 部署（推荐：Docker）

```sh
curl -fsSL https://get.docker.com | sh                 # 安装 Docker（已装可跳过）
git clone https://github.com/Freecode100Year/private-talk.git
cd private-talk
DOMAIN=chat.你的域名 docker compose up -d
```

一两分钟后打开 `https://chat.你的域名`。Caddy 负责 HTTPS，证书自动续期。

**不想用 Docker**：按 [docs/vps.md](../vps.md) 安装 Node.js，用自带的 systemd 服务文件（已做安全加固）开机自启，再用 Caddy 或 nginx 提供 HTTPS。

**服务器上已经有 nginx 等网站**：只运行应用容器，让 nginx 转发（配置示例 [deploy/nginx.conf](../../deploy/nginx.conf)）：

```sh
docker run -d --name private-talk --restart unless-stopped --read-only --cap-drop ALL \
  -p 127.0.0.1:8080:8080 -e TRUST_PROXY=1 ghcr.io/freecode100year/private-talk:1
```

## 3. 发给大家

把 `https://chat.你的域名` 和[用户使用手册](user.md)发给使用者。

## 4. 日常维护

- 查看是否在运行：`docker compose ps`（状态 healthy 即正常）。
- 程序不写日志、不存数据，没有需要备份的东西。
- 系统安全更新：Debian / Ubuntu 打开自动安全更新（`apt install unattended-upgrades`）。

## 5. 升级

```sh
cd private-talk
git pull
docker compose pull && docker compose up -d
```

镜像标签 `:1` 只会更新到 1.x 的兼容版本，不会突然升级到不兼容的大版本。

## 6. 安全注意

- SSH 用密钥登录，关闭密码登录。
- 只开放 22（或你的 SSH 端口）、80、443。
- VPS 服务商能看到服务器上的一切，但聊天内容在浏览器里加密，服务器上只有看不懂的密文、而且不保存。
- 想隐藏服务器真实 IP，可以把域名放到 Cloudflare 并开启代理（橙色云），或改用[家用设备手册](home.md)里的 Cloudflare Tunnel 方式。

## 7. 出问题

| 现象 | 做法 |
| :--- | :--- |
| 打不开，浏览器提示证书错误 | DNS 还没生效或 80 端口没开，Caddy 申请不到证书；`docker compose logs caddy` 查看 |
| 首页能开，进房间一直“正在连接” | nginx 没转发 WebSocket：检查 `Upgrade` / `Connection` 头（见 deploy/nginx.conf） |
| 同一网络的很多人进不了房 | 他们共用一个公网 IP，触发了每分钟 30 次的进房限制；设置 `JOIN_LIMIT` 调高 |

更多见 [故障排查](troubleshooting.md)。
