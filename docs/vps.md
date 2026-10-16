# 在普通 VPS 上部署（不用 Docker）

适合已经有一台境外 Linux VPS（Debian / Ubuntu）和一个域名的人。整个过程约 10 分钟。用的是发布页的 Linux 安装包：**自带 Node.js 22，不用另装 Node，也不用克隆源码**；以后用包里的 `update.sh` 升级和回退。

下文的 `chat.example.com` 换成你自己的域名。ARM 服务器把 `linux-x64` 换成 `linux-arm64`。

## 1. 准备

- 域名的 A 记录（有 IPv6 的话再加 AAAA）指向这台 VPS。
- 防火墙开放 80 和 443 端口。

## 2. 下载程序

```sh
cd /tmp
curl -fsSLO https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-x64.tar.gz
curl -fsSLO https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-x64.tar.gz.sig
tar -xzf private-talk-linux-x64.tar.gz
sudo mv private-talk-*-linux-x64 /opt/private-talk
sudo useradd --system --no-create-home --shell /usr/sbin/nologin private-talk
printf 'PORT=8080\nHOST=127.0.0.1\nTRUST_PROXY=1\n' | sudo tee /opt/private-talk/config.env
```

程序文件归 root 所有，运行用的 `private-talk` 账号只能读、不能改。设置写在 `/opt/private-talk/config.env`，写错时程序不会启动并说明原因；升级不会动它。

## 3. 用 systemd 开机自启

服务文件在包里的 `app/deploy/private-talk.service`（[仓库里同一个文件](../deploy/private-talk.service)），已做安全加固：程序只能读自己的文件、只能联网。

```sh
sudo cp /opt/private-talk/app/deploy/private-talk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now private-talk
systemctl status private-talk                  # 应显示 active (running)
curl -s http://127.0.0.1:8080/healthz          # 应显示 {"ok":true,"version":"…"}
```

程序只监听本机，外面要通过下一步的 HTTPS 访问。

## 4. 配置 HTTPS（二选一）

### 方案 A：Caddy（推荐，自动申请证书）

```sh
sudo apt install -y caddy
sudo cp /opt/private-talk/app/deploy/Caddyfile.vps /etc/caddy/Caddyfile
sudo sed -i 's/chat.example.com/你的域名/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy 默认不记录访问日志。

### 方案 B：nginx + certbot

```sh
sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot certonly --nginx -d 你的域名
sudo cp /opt/private-talk/app/deploy/nginx.conf /etc/nginx/sites-available/private-talk
sudo sed -i 's/chat.example.com/你的域名/g' /etc/nginx/sites-available/private-talk
sudo ln -s /etc/nginx/sites-available/private-talk /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

示例配置已关闭访问日志，并转发了 WebSocket。

## 5. 确认部署成功

```sh
cd /opt/private-talk
sudo ./node/bin/node app/server/smoke.mjs https://你的域名     # 两个测试客户端互发一条加密消息，最后一行应是 OK
```

再用浏览器打开 `https://你的域名/`，电脑和手机用同一个暗号进房间互发消息。

## 6. 升级和回退

```sh
cd /tmp
curl -fsSLO https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-x64.tar.gz
curl -fsSLO https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-x64.tar.gz.sig
sudo systemctl stop private-talk
sudo /opt/private-talk/update.sh /tmp/private-talk-linux-x64.tar.gz
sudo systemctl start private-talk
sudo /opt/private-talk/node/bin/node /opt/private-talk/app/server/smoke.mjs https://你的域名
```

`update.sh` 先核对签名、在备用端口试运行新版本，正常才替换；`config.env` 不动，上一个版本留在 `/opt/private-talk/previous`。有问题：

```sh
sudo systemctl stop private-talk && sudo /opt/private-talk/update.sh --rollback && sudo systemctl start private-talk
```

升级会断开当前所有房间（房间本来就只存在内存里），浏览器会自动重连，但之前的消息不会保留；回退也不会恢复它们。

## 7. 可调整的设置

写在 `/opt/private-talk/config.env`（每行 `名字=值`），然后 `sudo systemctl restart private-talk`：

| 变量 | 本页的值 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `8080` | 监听端口（同时修改 Caddy 或 nginx 里的端口） |
| `HOST` | `127.0.0.1` | 监听地址；只让本机的 Caddy / nginx 访问 |
| `TRUST_PROXY` | `1` | 程序在 Caddy 或 nginx 后面时保持为 1 |
| `JOIN_LIMIT` | `60`（默认） | 同一 IP 每分钟最多进房次数 |
| `MAX_CONNECTIONS` | `2000`（默认） | 同时在线连接上限，超出时新来的人看到“服务器连接数已满” |

## 8. 日常维护

- 状态：`cd /opt/private-talk && sudo ./status.sh`（版本、设置、是否在运行）。
- 日志：`journalctl -u private-talk`。只有启动、警告和错误，不含访客信息。
- 备份：没有聊天记录可备份；保留 `/opt/private-talk/config.env` 即可。
