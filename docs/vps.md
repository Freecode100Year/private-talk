# 在普通 VPS 上部署（不用 Docker）

适合已经有一台境外 Linux VPS（Debian / Ubuntu）和一个域名的人。整个过程约 10 分钟。

下文的 `chat.example.com` 换成你自己的域名。

## 1. 准备

- 域名的 A 记录（有 IPv6 的话再加 AAAA）指向这台 VPS。
- 防火墙开放 80 和 443 端口。

## 2. 安装 Node.js 22

Debian 13 / Ubuntu 24.04 以上可以直接装系统自带的版本，先确认版本号不低于 20：

```sh
sudo apt update
sudo apt install -y nodejs npm git
node --version
```

版本太旧的话，按 Node.js 官网的说明安装：<https://nodejs.org/en/download>

## 3. 下载程序

```sh
sudo useradd --system --home /opt/private-talk --shell /usr/sbin/nologin private-talk
sudo git clone https://github.com/Freecode100Year/private-talk.git /opt/private-talk
cd /opt/private-talk
sudo git checkout v1.0.0      # 固定到一个发布版本；以后升级时换成新版本号
sudo npm ci --omit=dev --ignore-scripts
```

程序文件归 root 所有，运行用的 `private-talk` 账号只能读、不能改。

## 4. 用 systemd 开机自启

仓库里的 [`deploy/private-talk.service`](../deploy/private-talk.service) 已经做了安全加固：程序只能读自己的文件、只能联网，不能碰系统其他部分。

```sh
sudo cp deploy/private-talk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now private-talk
systemctl status private-talk        # 应显示 active (running)
curl -I http://127.0.0.1:8080/       # 应返回 200
```

程序只监听本机，外面要通过下一步的 HTTPS 访问。

## 5. 配置 HTTPS（二选一）

### 方案 A：Caddy（推荐，自动申请证书）

```sh
sudo apt install -y caddy
sudo cp deploy/Caddyfile.vps /etc/caddy/Caddyfile
sudo sed -i 's/chat.example.com/你的域名/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy 默认不记录访问日志。

### 方案 B：nginx + certbot

```sh
sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot certonly --nginx -d 你的域名
sudo cp deploy/nginx.conf /etc/nginx/sites-available/private-talk
sudo sed -i 's/chat.example.com/你的域名/g' /etc/nginx/sites-available/private-talk
sudo ln -s /etc/nginx/sites-available/private-talk /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

示例配置已关闭访问日志，并转发了 WebSocket。

## 6. 打开试试

浏览器打开 `https://你的域名/`，进入房间。在另一台设备上打开同一个房间链接，互相发一条消息。

## 升级

```sh
cd /opt/private-talk
sudo git fetch --tags
sudo git checkout v1.1.0      # 换成要升级到的版本
sudo npm ci --omit=dev --ignore-scripts
sudo systemctl restart private-talk
```

重启会断开当前所有房间（房间本来就只存在内存里）。浏览器会自动重连，但重启前的消息不会保留。

## 可调整的设置

修改 `/etc/systemd/system/private-talk.service` 里的 `Environment=` 行，然后运行 `sudo systemctl daemon-reload && sudo systemctl restart private-talk`：

| 变量 | 默认 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `8080` | 监听端口（同时修改 Caddy 或 nginx 里的端口） |
| `HOST` | `127.0.0.1` | 监听地址；只让本机的 Caddy / nginx 访问 |
| `TRUST_PROXY` | `1` | 程序在 Caddy 或 nginx 后面时保持为 1 |
| `JOIN_LIMIT` | `30` | 同一 IP 每分钟最多进房次数 |
