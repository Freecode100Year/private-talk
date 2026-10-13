# 家用设备手册（家里的电脑、NAS、树莓派）

**适合**：不想租服务器，家里有一台常开的设备；家里没有公网 IP 也没关系。
**结果**：`https://chat.你的域名`，通过 Cloudflare Tunnel 对外，家里不用开任何端口。
**费用**：免费（需要一个托管在 Cloudflare 的域名）。

## 需要下载什么

| 设备 | 需要下载 |
| :--- | :--- |
| Windows / Mac | [Docker Desktop](https://www.docker.com/products/docker-desktop/) |
| Linux / 树莓派 | Docker：`curl -fsSL https://get.docker.com \| sh` |
| 群晖 / 威联通 NAS | 套件中心里的 Container Manager / Container Station（不用另外下载） |
| 所有设备 | 部署文件包 [private-talk-compose.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-compose.tar.gz)（不需要源码） |

镜像 `ghcr.io/freecode100year/private-talk:2` 和 `cloudflare/cloudflared` 在启动时自动下载，不用手动下载 cloudflared。

## 1. 准备

- 一台常开的设备，装好 Docker：
  - 电脑：Windows / macOS 装 Docker Desktop，Linux 用 `curl -fsSL https://get.docker.com | sh`。
  - 群晖 / 威联通 NAS：套件中心里的 Container Manager / Container Station。
  - 树莓派：64 位系统，`curl -fsSL https://get.docker.com | sh`。
- 一个已托管在 Cloudflare 的域名。

### 安装 Docker Desktop（Windows / Mac）

1. 从 [docker.com](https://www.docker.com/products/docker-desktop/) 下载 Docker Desktop 并安装。
2. Windows 安装时保持勾选「Use WSL 2」；装完按提示重启电脑。
3. 打开 Docker Desktop，等左下角显示 Engine running（绿色）。
4. 在设置里打开「Start Docker Desktop when you sign in」，这样开机会自动运行。

## 2. 在 Cloudflare 创建隧道

1. Cloudflare 后台 → Zero Trust → 网络 → 隧道 → 创建隧道 → 选 Cloudflared。
2. 起个名字，复制页面上的**隧道令牌**（很长的一串，相当于密码，不要发给别人）。
3. 在隧道的「公共主机名」里添加：子域名 `chat`、域名选你的域名，服务类型 `HTTP`，URL 填 `app:8080`。

## 3. 在设备上运行

```sh
curl -fsSL https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-compose.tar.gz | tar -xz
cd private-talk-docker
cat > .env <<'EOF2'
COMPOSE_FILE=docker-compose.tunnel.yml
TUNNEL_TOKEN=粘贴隧道令牌
DOMAIN=chat.你的域名
EOF2
chmod 600 .env
docker compose up -d
./pt status            # 最后一行应是 OK
```

`.env` 里的令牌相当于密码：只留在这台设备上，不要发给别人。以后的命令都在这个文件夹运行，不用再输入令牌。

NAS 的图形界面：新建项目（Compose），把 `docker-compose.tunnel.yml` 的内容粘进去，在环境变量里填 `TUNNEL_TOKEN`（这种方式用不了 `./pt`，升级时把镜像版本号改成新版本）。

一两分钟后打开 `https://chat.你的域名`。

## 4. 确认部署成功

1. Cloudflare 后台的隧道列表里，这条隧道显示「健康 / Healthy」。
2. 浏览器打开 `https://chat.你的域名`，看到首页。
3. 电脑和手机（用手机流量，不连家里 Wi-Fi）用同一个暗号进房间，互发消息能收到。

## 5. 发给大家

把网址和[用户使用手册](user.md)发给使用者。

## 6. 日常维护

- 设备要一直开着、不能睡眠（电脑在电源设置里关闭睡眠）。
- Cloudflare 后台隧道页面显示「健康」即正常。
- 不存数据，不需要备份。

## 7. 升级

```sh
cd private-talk-docker
./pt upgrade            # 自检不过会自动回到原版本；./pt rollback 手动回退
```

## 8. 安全注意

- 家里的公网 IP 不会暴露，访问者只看到 Cloudflare。
- 隧道令牌泄露的话，到 Cloudflare 后台删除这个隧道重建。
- Cloudflare 能看到访问记录，看不到聊天内容。

## 9. 卸载

```sh
cd private-talk-docker && docker compose down && cd .. && rm -rf private-talk-docker
```

再到 Cloudflare 后台删除这条隧道和它的公共主机名。

## 10. 出问题

| 现象 | 做法 |
| :--- | :--- |
| 打开显示 Cloudflare 错误 1033 | 隧道没连上：设备没开、令牌填错，`./pt logs cloudflared` 查看 |
| 显示 502 | 公共主机名的服务地址要填 `app:8080`（不是 localhost） |

只想在家里局域网用、不对外？看[局域网手册](lan.md)。更多见 [故障排查](troubleshooting.md)。
