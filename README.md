# 隐匿对话

**只给知道暗号的人，聊完不留痕。** 匿名、临时、端对端加密的私密房间：无需账号，不保存消息。暗号永久有效：有人用它打开，房间就在；所有人离开，房间就消失，下次用同一个暗号还能再打开（以前的消息不会回来）。

线上地址：<https://chat.freedom8964.com>

## 怎么用

**最简单的方法**：任何时候在浏览器地址栏输入 `https://chat.freedom8964.com/#` ，在 `#` 后面加上房间暗号（例如 `https://chat.freedom8964.com/#你的暗号`），回车就进入房间；把这个网址发给朋友，对方打开就进同一个房间。

暗号可以是数字、英文字母、简体中文、繁体中文，最短 1 个字、最长 64 个字。全角字母数字会自动转成半角；简体和繁体是不同的字，所以“龙”和“龍”是两个不同的房间；英文区分大小写。

1. 也可以打开网站首页：首页已经**随机生成了一个 22 位暗号**（约 128 位随机数，无法猜中），直接点“进入房间”。不满意可以点“换一个”，或者自己输入暗号。
2. 点“复制房间链接”，通过可信渠道发给对方（别用微信、QQ），发出后清空剪贴板。链接形如 `https://chat.freedom8964.com/#暗号`。
3. 对方打开链接就进入同一个房间。最多 10 人（编号 1️⃣～🔟），每条消息最多 500 字 / 2048 字节，每人每 6 秒只能发一条（发送按钮会倒数 6、5、4…）。
4. 人到齐后可以点“锁定房间”，之后谁拿到链接都进不来；任何成员都能解除锁定。
5. 按 Esc 或点“清屏”立即清空屏幕；“消息保留”可以设成 1 / 5 / 30 分钟后自动从屏幕上删掉。
6. 离开时点“离开房间”或直接关掉页面。

## 隐私设计

| | 做法 |
| :--- | :--- |
| 暗号 | 默认随机生成。只在浏览器里用：放在链接 `#` 后面，浏览器不会把它发给服务器；进入房间后立即从地址栏抹掉；页面上只显示 4 位房间代号（如“房间 7F3A”），截图不会泄露暗号 |
| 房间地址 | 由暗号经 PBKDF2-SHA256（31 万次）算出的 64 位十六进制，服务器无法反推暗号 |
| 消息 | 浏览器用暗号派生的 AES-256-GCM 密钥加密；服务器只转发密文，没有密钥 |
| 防篡改 | 发送人编号、消息编号和发送时间都封在密文里。浏览器核对服务器标注的发送人，并拒绝重复或超过 10 分钟的消息，所以被控制的服务器也无法冒充发送人或重放旧消息 |
| 历史 | 不存储。服务器（Cloudflare Durable Object）只在内存里转发；新加入的人看不到之前的消息 |
| 身份 | 无账号、无昵称，按进入顺序标记为 1️⃣～🔟，每条消息显示来自哪个编号。先发没用过的编号，10 个都用过后再发最早空出的那个，新来的人不会马上顶替刚离开的人；有人进出时房间里会提示 |
| 网页 | 无外部资源、无统计、无 Cookie；CSP 只允许本站资源，不发送 Referer，禁止被其他网站嵌入；强制 HTTPS（HSTS） |
| 防滥用 | 每个房间最多 10 人，可锁定；每人每 6 秒一条消息（服务器同样检查）；每个连接 10 秒内最多 20 个数据帧；单帧上限 4 KB；只接受本站页面发起的连接；同一 IP 每分钟进房次数有上限（Cloudflare 边缘内存计数，不记录） |
| 不留痕迹 | 不使用 Cookie、localStorage 等任何浏览器存储；所有页面和脚本都带 `Cache-Control: no-store`，不写入磁盘缓存；打开、切到后台和关闭页面时请求 `/bye`，服务器回 `Clear-Site-Data: "cache", "storage"`（不清 Cookie：Cookie 的清除范围是整个注册域名，会把同域名其他网站的登录一起清掉），浏览器随即清空本站缓存和数据；覆盖 Cloudflare 默认的网络错误上报（`NEL: {"max_age":0}`），浏览器不再保存上报规则；离开时从内存中丢掉暗号、密钥和消息；消息输入框关闭拼写检查（避免增强拼写检查把文字发给第三方） |
| 断线 | 手机锁屏、切换网络断开后自动重连（重连后是新的编号，断线期间的消息收不到） |

**要知道的限制**：
- 暗号就是唯一的钥匙。暗号越短、越常见，别人越容易猜中并进入房间、解密消息（短于 8 个字时房间里会提醒）。重要的谈话请用随机生成的暗号。
- 服务器看不到内容，但能看到连接的 IP 地址和时间，以及哪些连接在同一个房间（Cloudflare 的网络层面）。需要隐藏 IP 请配合可信的 VPN。
- 网页版加密的代码由服务器下发：部署账号一旦被盗，代码可能被替换。部署账号务必开启两步验证。
- 输入法、剪贴板管理器、手机系统本身都能看到你打的字，这超出网页能保护的范围。不要用带云输入的输入法。
- 浏览器历史记录（包括地址栏输入过的带暗号的网址）网页无权删除，建议用无痕 / 隐私窗口打开。
- 没有验证对方身份的机制（任何知道暗号的人都只是一个编号）。

## 自己部署

任何人都可以部署一个属于自己的隐匿对话。先按情况选一种：

| 你的情况 | 推荐方式 | 费用 |
| :--- | :--- | :--- |
| 没有服务器，想最省事 | [① 一键部署到 Cloudflare](#-一键部署到-cloudflare) | 免费额度够小范围使用 |
| 有境外 VPS 和域名 | [② Docker + 自动 HTTPS](#-docker--自动-https) | VPS 费用 |
| 家里的电脑、NAS、树莓派，没有公网 IP | [③ Cloudflare Tunnel](#-cloudflare-tunnel家里的机器) | 免费 |
| 不想管服务器 | [④ 云平台一键部署](#-云平台一键部署) | 各平台免费/低价套餐 |
| 有 VPS，但不想用 Docker | [⑤ 普通 VPS 教程](docs/vps.md) | VPS 费用 |

所有方式通用的几点：

- **必须 HTTPS**：浏览器只在 HTTPS（或 localhost）下允许网页加密。以上方式都自带 HTTPS。
- **只能跑一个实例**（Cloudflare 除外）：房间存在进程内存里，开多个实例时，同一个暗号的人可能被分到不同实例而碰不到面。
- **用境外服务器**：中国大陆的服务器开放网站需要备案，这类站点也不适合放在境内。
- **锁定版本**：Docker 镜像用 `:1` 这样的版本号标签（不会突然升级到不兼容的大版本）；源码可以 `git checkout v1.0.0` 固定到某个发布版。

### ① 一键部署到 Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Freecode100Year/private-talk)

点按钮，登录自己的 Cloudflare 账号，按提示把仓库复制到自己的 GitHub，几分钟后就会得到一个 `https://private-talk.<你的子域>.workers.dev` 网址。之后可以在 Cloudflare 后台 Workers → private-talk → Settings → Domains & Routes 绑定自己的域名。

也可以用命令行：

```sh
git clone https://github.com/Freecode100Year/private-talk.git && cd private-talk
npm install
npx wrangler login
npx wrangler deploy                          # 部署到 workers.dev
npx wrangler deploy --domain chat.example.com  # 或同时绑定自己的域名（域名需已在这个 Cloudflare 账号里）
```

免费版每天有用量上限（大约够房间累计活跃 29 小时），超出后当天无法进房；每月 5 美元的 Workers 付费版超出部分按量计费，不会停。

### ② Docker + 自动 HTTPS

现成镜像：`ghcr.io/freecode100year/private-talk`（支持 amd64 和 arm64，由 GitHub Actions 从本仓库源码自动构建）。

```sh
git clone https://github.com/Freecode100Year/private-talk.git && cd private-talk
# 先把域名的 A/AAAA 记录指向这台服务器，并开放 80、443 端口
DOMAIN=chat.example.com docker compose up -d
```

Caddy 会自动申请和续期证书。想从源码自己构建镜像，在命令后加 `--build`。

已经有 nginx 等反向代理的，只跑应用容器即可（nginx 配置示例见 [`deploy/nginx.conf`](deploy/nginx.conf)）：

```sh
docker run -d --name private-talk --restart unless-stopped --read-only --cap-drop ALL \
  -p 127.0.0.1:8080:8080 -e TRUST_PROXY=1 ghcr.io/freecode100year/private-talk:1
```

反向代理需要转发 WebSocket（`Upgrade`/`Connection` 头），并传 `Host`、`X-Forwarded-Proto`、`X-Forwarded-For`。

| 环境变量 | 默认 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `8080` | 监听端口 |
| `HOST` | 所有地址 | 监听地址（容器里保持默认） |
| `TRUST_PROXY` | 不信任 | 设为 `1` 时采用反向代理传来的 `X-Forwarded-For`（按 IP 限速用）和 `X-Forwarded-Proto`（校验来源用）。程序直接对外暴露时不要开 |
| `JOIN_LIMIT` | `30` | 同一 IP 每分钟最多进房次数 |

### ③ Cloudflare Tunnel（家里的机器）

不用开端口、不用公网 IP，HTTPS 由 Cloudflare 提供。需要一个托管在 Cloudflare 的域名。

1. Cloudflare 后台 → Zero Trust → Networks → Tunnels → 创建隧道（Cloudflared），复制隧道令牌（token）。
2. 在这个隧道的 Public Hostname 里添加你的子域名，Service 选 `HTTP`，地址填 `app:8080`。
3. 在机器上运行：

```sh
git clone https://github.com/Freecode100Year/private-talk.git && cd private-talk
TUNNEL_TOKEN=<隧道令牌> docker compose -f docker-compose.tunnel.yml up -d
```

隧道令牌相当于密码，不要发给别人。

### ④ 云平台一键部署

这些平台都自带 HTTPS 和免费子域名。**都只开 1 个实例**（配置文件里已经写好）。免费套餐空闲时可能休眠，第一次打开要等十几秒。

| 平台 | 做法 |
| :--- | :--- |
| Render | [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Freecode100Year/private-talk) 点按钮即可（读取 `render.yaml`） |
| Koyeb | [![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&repository=github.com/Freecode100Year/private-talk&branch=main&builder=dockerfile&name=private-talk&ports=8080;http;/&env[TRUST_PROXY]=1) 点按钮即可 |
| Railway | New Project → Deploy from GitHub repo → 选择本仓库（或你的复制）。会读取 `railway.json` 用 Dockerfile 构建；再到 Settings → Networking → Generate Domain，并在 Variables 里加 `TRUST_PROXY=1` |
| Zeabur | 新建项目 → 部署服务 → GitHub → 选择本仓库，会自动识别 Dockerfile；在网络里生成域名（端口 8080），环境变量加 `TRUST_PROXY=1` |
| Fly.io | 装好 `flyctl` 后在仓库目录运行 `fly launch --copy-config --no-deploy`（按提示改一个唯一的应用名），然后 `fly deploy`、`fly scale count 1` |

### ⑤ 普通 VPS（不用 Docker）

见 [docs/vps.md](docs/vps.md)：安装 Node.js、用 systemd 开机自启（附带安全加固的服务文件）、Caddy 或 nginx 提供 HTTPS。

## 目录

| 路径 | 内容 |
| :--- | :--- |
| `dist/` | 网页：`index.html`、`app.js`（界面与连接）、`crypto.js`（密钥派生与加解密）、`state.js`（暗号与消息规则）、`_headers`（安全响应头） |
| `src/worker.js` | Cloudflare Worker：静态资源 + `/ws/<房间>` WebSocket 转发（每个房间一个 Durable Object，不存储任何内容） |
| `src/rules.js` | 两种部署共用的规则：人数、编号、发送间隔、限速 |
| `server/server.mjs` | Docker 版服务器（Node + ws），与 Worker 行为一致 |
| `Dockerfile`、`docker-compose.yml`、`Caddyfile` | Docker 部署（含自动 HTTPS） |
| `docker-compose.tunnel.yml` | 通过 Cloudflare Tunnel 部署 |
| `render.yaml`、`railway.json`、`fly.toml` | 云平台部署配置 |
| `deploy/` | systemd 服务文件、Caddy 和 nginx 示例 |
| `docs/vps.md` | 普通 VPS 部署教程 |
| `.github/workflows/` | 自动测试；构建并发布 Docker 镜像 |
| `test/` | 规则、加密与防篡改的单元测试 |
| `wrangler.jsonc` | 部署配置（自定义域名 chat.freedom8964.com） |

## 开发

```sh
npm test               # Node 18+
npx wrangler dev       # 本地运行（含 WebSocket 转发）
npm run deploy:freedom8964  # 部署 chat.freedom8964.com（本站维护者用）
npm start              # 本地运行 Docker 版的服务器（http://localhost:8080）
```
