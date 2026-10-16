# 局域网 / 内网部署

在家里、办公室、活动现场的同一个网络里聊天，**不需要互联网**：断网、没有公网 IP、内网与外界隔离都能用。服务器和所有人的设备只要能互相访问即可。

## 为什么必须 HTTPS

网页在浏览器里加密消息（Web Crypto），浏览器只在 HTTPS 或 `localhost` 下允许这样做。用 `http://192.168.1.20:8080` 打开，页面会提示无法加密。所以局域网模式会自动给本机生成证书，用 HTTPS 提供服务。

内网不能上互联网？用离线安装包，解压即用，见 [docs/offline.md](offline.md)。

## 方式一：Node.js（Windows / macOS / Linux / 安卓 Termux）

```sh
git clone https://github.com/Freecode100Year/private-talk
cd private-talk
npm ci --omit=dev
npm run lan
```

启动后会列出地址，例如：

```text
同一网络里的人用浏览器打开：
  https://192.168.1.20:8443/
  https://mypc.local:8443/
```

把地址发给同一网络里的人即可。房间暗号和链接用法与线上版完全一样：`https://192.168.1.20:8443/#暗号`。

可选环境变量：

| 变量 | 作用 |
| :--- | :--- |
| `PORT` | 端口，默认 `8443` |
| `LAN_NAMES` | 额外加入证书的名字或地址，逗号分隔，例如 `chat.lan,10.0.5.8`（内网 DNS 名、找不到的地址） |
| `LAN_CERTS` | 证书目录，默认 `./lan-certs` |
| `JOIN_LIMIT` | 每个地址每分钟最多进入房间次数，默认 60 |

## 方式二：Docker（Linux）

```sh
docker compose -f docker-compose.lan.yml up -d
docker compose -f docker-compose.lan.yml logs app     # 查看要打开的地址
```

Docker Desktop（Windows/macOS）上：在 `docker-compose.lan.yml` 里删掉 `network_mode: host`，打开 `ports`，并在 `LAN_NAMES` 填电脑的局域网 IP。

## 第一次打开的证书提示

证书是本机自己签发的，浏览器第一次会提示“连接不是私密连接 / 此连接不受信任”。两种处理：

1. **直接继续**：点“高级”→“继续前往”。连接照样是加密的，网页加密也能用。缺点是每台设备、每个浏览器都要点一次，而且看不出是不是被人冒充了。
2. **安装本机 CA 证书（推荐长期使用）**：把 `lan-certs/ca.crt`（Docker：`docker compose -f docker-compose.lan.yml cp app:/certs/ca.crt .`）发到各设备安装：
   - Windows：双击 → 安装证书 → 本地计算机 →“受信任的根证书颁发机构”。
   - macOS：双击加入“钥匙串访问”→ 双击证书 →“信任”→“始终信任”。
   - iPhone/iPad：用 AirDrop 或文件打开 → 设置里“已下载描述文件”安装 → 设置 → 通用 → 关于本机 → 证书信任设置 → 打开。
   - 安卓：设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书。
   - Firefox 使用自己的证书库：设置 → 隐私与安全 → 证书 → 查看证书 → 导入。

**这个 CA 不会危害其他网站**：它带有“名称约束”，只能为局域网地址（`10.x`、`172.16–31.x`、`192.168.x`、`100.64–127.x`、`fc00::/7`）和 `.local`、`.lan`、`.home.arpa`、`.internal`、`localhost` 签发证书。即使它的私钥泄露，也无法用来冒充任何公网网站。
`lan-certs/ca.key` 仍然要保管好：拿到它的人可以冒充你局域网里的这台服务器。不要把 `lan-certs` 目录发给别人，只发 `ca.crt`。

服务器证书有效期 397 天（浏览器允许的上限），到期前 30 天或本机地址变化时，重新启动就会自动换新；CA 有效期 10 年，换新服务器证书不需要重新安装 CA。

## 公司或学校内网

- 内网有自己的域名和证书（IT 部门签发）时，可以不用自动证书：
  `TLS_CERT=证书.pem TLS_KEY=私钥.pem PORT=443 npm start`
- 已经有内网反向代理（nginx、Caddy、IIS）时，按 [docs/vps.md](vps.md) 的做法让代理提供 HTTPS，程序只监听本机，并设置 `TRUST_PROXY=1`。
- 内网 DNS 可以加一条记录（例如 `chat.internal` → 服务器 IP），再用 `LAN_NAMES=chat.internal` 把它放进证书。
- 跨城市、跨家庭的“私人内网”可以用 Tailscale：见 [docs/tailscale.md](tailscale.md) 的 private 模式。

## 需要知道的

- 同一网络里的其他人能看到“谁连了这台服务器”，看不到内容（内容在浏览器里加密，服务器也看不懂）。
- 防火墙要放行端口 `8443`（Windows 第一次启动 Node.js 时会弹窗询问，选“专用网络”）。
- 路由器开启了“AP 隔离 / 访客网络隔离”时，设备之间互相访问不了，需要关闭或换到主网络。
- 房间只存在服务器内存里，服务器关掉，所有房间消失。
