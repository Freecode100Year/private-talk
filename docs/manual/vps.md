# VPS 手册（境外服务器 + 域名）

**适合**：有一台境外 VPS 和一个域名，想自己完全掌控服务器的人。
**结果**：`https://chat.你的域名`，证书自动申请和续期。
**费用**：VPS 和域名的费用。程序本身很省资源，最小配置（1 核 512MB）就够几十个房间。

## 需要下载什么

以下都在 VPS 上用命令下载，你的电脑上不需要装任何东西（只要能 SSH 登录）。

| 方式 | 需要下载 |
| :--- | :--- |
| Docker（推荐） | Docker：`curl -fsSL https://get.docker.com \| sh`；部署文件包 [private-talk-compose.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-compose.tar.gz)（第 2 步用命令下载，不需要源码）。程序镜像和 Caddy 按固定版本在启动时自动下载 |
| 不用 Docker | 离线包 [private-talk-linux-x64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-x64.tar.gz)（ARM 服务器用 [linux-arm64](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-arm64.tar.gz)），自带 Node.js，不用另装；HTTPS 再装 [Caddy](https://caddyserver.com/docs/install) 或 nginx |

## 1. 准备

- 一台境外 Linux VPS（Debian / Ubuntu 最省事），能用 SSH 登录。
  中国大陆的服务器开网站需要备案，这类站点也不适合放在境内。
- 一个域名，在 DNS 里加一条 A 记录（有 IPv6 再加 AAAA）：`chat.你的域名` → VPS 的 IP。
- VPS 防火墙开放 80 和 443 端口。

### 登录服务器

在自己的电脑上打开终端（Windows 用 PowerShell，Mac 用「终端」），用服务商给的 IP 和密码 / 密钥登录：

```sh
ssh root@你的服务器IP
```

### 设置域名

在域名服务商（或 Cloudflare）的 DNS 设置里添加一条记录：类型 `A`，名称 `chat`，值填服务器 IP。等几分钟到几十分钟生效，可以用 `ping chat.你的域名` 检查是否已指向服务器。

### 开放端口

```sh
# Debian / Ubuntu 用 ufw 时：
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
```

服务商网页后台如果有“安全组 / 防火墙”，也要放行 80 和 443。

## 2. 部署（推荐：Docker）

```sh
curl -fsSL https://get.docker.com | sh                 # 安装 Docker（已装可跳过）
curl -fsSL https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-compose.tar.gz | tar -xz
cd private-talk-docker
./pt setup chat.你的域名
```

`./pt setup` 会把域名和程序版本存进 `.env`，启动程序和 Caddy，等证书签好后自己做一次聊天自检（两个测试客户端进同一个随机房间互发一条加密消息）。看到“✓ 部署完成”就可以用了。Caddy 负责 HTTPS，证书自动续期。

以后的命令都在 `private-talk-docker` 文件夹里运行，`.env` 会被自动读取，不用再输入域名。`docker compose ps`、`docker compose restart` 等原生命令也照样能用。

（也可以 `git clone` 整个仓库，在仓库目录里运行同样的 `./pt setup`。想从源码自己构建镜像：`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`。）

**不想用 Docker**：按 [docs/vps.md](../vps.md) 安装 Node.js，用自带的 systemd 服务文件（已做安全加固）开机自启，再用 Caddy 或 nginx 提供 HTTPS。

**服务器上已经有 nginx 等网站**：只运行应用容器，让 nginx 转发（配置示例 [deploy/nginx.conf](../../deploy/nginx.conf)）：

```sh
docker run -d --name private-talk --restart unless-stopped --read-only --cap-drop ALL \
  -p 127.0.0.1:8080:8080 -e TRUST_PROXY=1 ghcr.io/freecode100year/private-talk:2.20.0   # 写具体版本
```

## 3. 确认部署成功

```sh
./pt status        # 版本、容器状态，以及经过真实网址的聊天自检，最后一行应是 OK
```

然后在浏览器打开 `https://chat.你的域名`，电脑和手机用同一个暗号进房间互发消息。

## 4. 发给大家

把 `https://chat.你的域名` 和[用户使用手册](user.md)发给使用者。

## 5. 日常维护

- 查看状态：`./pt status`。
- 查看日志：`./pt logs`。只有启动、证书和错误信息（每个服务最多约 2 MB，自动轮换）；不记录访客 IP、访问网址、房间或暗号。
- 备份：没有聊天记录可备份。请保留 `.env`（域名、版本，以及 Tunnel / Tailscale 令牌，是机密）。Caddy 的证书在 Docker 卷 `caddy_data` 里，丢了会自动重新申请。
- 系统安全更新：Debian / Ubuntu 打开自动安全更新（`apt install unattended-upgrades`）。

## 6. 升级和回退

```sh
./pt upgrade            # 升级到最新发布版本；也可以写明版本：./pt upgrade 2.3.1
./pt rollback           # 回到升级前的版本
```

`./pt upgrade` 先下载新镜像（下载失败什么都不改），记下当前版本，切换后等程序健康、再做聊天自检；**自检不通过会自动回到原来的版本**。版本写在 `.env` 的 `PT_VERSION`，所以任何时候都清楚运行的是哪一版。

- 升级会断开当时的所有聊天（几秒钟）。房间和消息只在内存里，升级和回退都不会恢复它们；页面会自动重连，大家重新进房即可。
- `./pt upgrade` 只升级程序本身。部署文件（compose、Caddyfile、Caddy 版本）有变化时，发布说明里会写明，按说明下载新的部署文件包即可，`.env` 不受影响。

## 7. 安全注意

- SSH 用密钥登录，关闭密码登录。
- 只开放 22（或你的 SSH 端口）、80、443。
- VPS 服务商能看到服务器上的一切，但聊天内容在浏览器里加密，服务器上只有看不懂的密文、而且不保存。
- 想隐藏服务器真实 IP，可以把域名放到 Cloudflare 并开启代理（橙色云），或改用[家用设备手册](home.md)里的 Cloudflare Tunnel 方式。

## 8. 卸载

```sh
cd private-talk-docker && docker compose down -v && cd .. && rm -rf private-talk-docker
```

再删除 DNS 里的那条记录。

## 9. 出问题

| 现象 | 做法 |
| :--- | :--- |
| 打不开，浏览器提示证书错误 | DNS 还没生效或 80 端口没开，Caddy 申请不到证书；`./pt logs caddy` 查看 |
| `./pt status` 最后显示 ✗ | 按提示看：证书不被信任 → 证书还没签好；连接被关闭 → 代理没转发 WebSocket；超时 → 防火墙 |
| 首页能开，进房间一直“正在连接” | nginx 没转发 WebSocket：检查 `Upgrade` / `Connection` 头（见 deploy/nginx.conf） |
| 同一网络的很多人进不了房 | 他们共用一个公网 IP，触发了每分钟 60 次的进房限制；设置 `JOIN_LIMIT` 调高 |

更多见 [故障排查](troubleshooting.md)。
