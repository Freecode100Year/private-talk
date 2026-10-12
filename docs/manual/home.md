# 家用设备手册（家里的电脑、NAS、树莓派）

**适合**：不想租服务器，家里有一台常开的设备；家里没有公网 IP 也没关系。
**结果**：`https://chat.你的域名`，通过 Cloudflare Tunnel 对外，家里不用开任何端口。
**费用**：免费（需要一个托管在 Cloudflare 的域名）。

## 1. 准备

- 一台常开的设备，装好 Docker：
  - 电脑：Windows / macOS 装 Docker Desktop，Linux 用 `curl -fsSL https://get.docker.com | sh`。
  - 群晖 / 威联通 NAS：套件中心里的 Container Manager / Container Station。
  - 树莓派：64 位系统，`curl -fsSL https://get.docker.com | sh`。
- 一个已托管在 Cloudflare 的域名。

## 2. 在 Cloudflare 创建隧道

1. Cloudflare 后台 → Zero Trust → 网络 → 隧道 → 创建隧道 → 选 Cloudflared。
2. 起个名字，复制页面上的**隧道令牌**（很长的一串，相当于密码，不要发给别人）。
3. 在隧道的「公共主机名」里添加：子域名 `chat`、域名选你的域名，服务类型 `HTTP`，URL 填 `app:8080`。

## 3. 在设备上运行

```sh
git clone https://github.com/Freecode100Year/private-talk.git
cd private-talk
TUNNEL_TOKEN=粘贴隧道令牌 docker compose -f docker-compose.tunnel.yml up -d
```

NAS 的图形界面：新建项目（Compose），把 `docker-compose.tunnel.yml` 的内容粘进去，在环境变量里填 `TUNNEL_TOKEN`。

一两分钟后打开 `https://chat.你的域名`。

## 4. 发给大家

把网址和[用户使用手册](user.md)发给使用者。

## 5. 日常维护

- 设备要一直开着、不能睡眠（电脑在电源设置里关闭睡眠）。
- Cloudflare 后台隧道页面显示「健康」即正常。
- 不存数据，不需要备份。

## 6. 升级

```sh
cd private-talk && git pull
docker compose -f docker-compose.tunnel.yml pull
docker compose -f docker-compose.tunnel.yml up -d
```

## 7. 安全注意

- 家里的公网 IP 不会暴露，访问者只看到 Cloudflare。
- 隧道令牌泄露的话，到 Cloudflare 后台删除这个隧道重建。
- Cloudflare 能看到访问记录，看不到聊天内容。

## 8. 出问题

| 现象 | 做法 |
| :--- | :--- |
| 打开显示 Cloudflare 错误 1033 | 隧道没连上：设备没开、令牌填错，`docker compose -f docker-compose.tunnel.yml logs cloudflared` 查看 |
| 显示 502 | 公共主机名的服务地址要填 `app:8080`（不是 localhost） |

只想在家里局域网用、不对外？看[局域网手册](lan.md)。更多见 [故障排查](troubleshooting.md)。
