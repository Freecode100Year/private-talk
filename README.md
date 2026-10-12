# 隐匿对话

![隐匿对话 Private Talk：只给知道暗号的人，聊完不留痕](docs/images/banner.jpg)

**只给知道暗号的人，聊完不留痕。**

- **隐匿**：不要账号、不要手机号、不要昵称。消息在浏览器里加密，服务器只转发看不懂的密文，不保存消息，程序不写日志。
- **简单**：打开网址、输入暗号，就在同一个房间。不用装 App，手机电脑都能用。
- **随处可部署**：Cloudflare 免费一键部署、一行 Docker、断网的局域网、不能上互联网的企业内网，甚至一部安卓手机。

在线使用：<https://chat.freedom8964.com>　·　[说明书](docs/manual/README.md)　·　[隐私设计](docs/privacy.md)

## 30 秒上手

1. 打开 `https://chat.freedom8964.com/#你们的暗号`。
2. 把这个网址发给朋友。
3. 打开同一个网址的人进入同一个房间，最多 10 人。

暗号只用数字、英文字母或中文，不要符号。直接打开首页会随机生成一个无法猜中的暗号。人到齐后可以锁定房间，聊完关掉网页即可。详见 [用户使用手册](docs/manual/user.md)。

## 隐匿

| 谁 | 能看到 | 看不到 |
| :--- | :--- | :--- |
| 服务器运营方 | 你的 IP、上线时间、哪些连接在同一个房间 | 消息内容、暗号、你是谁 |
| 网络旁观者（运营商、Wi-Fi 管理者） | 你连了这个网站 | 内容、暗号、房间 |
| 房间里的人 | 消息，以及你的编号 1️⃣～🔟 | 你是谁、你的 IP |

- **端对端加密**：密钥由暗号在浏览器里算出（PBKDF2 31 万次 → AES-256-GCM）。暗号写在链接 `#` 后面，浏览器不会发给服务器，进入房间后立刻从地址栏抹掉。
- **不留存**：没有账号、没有消息历史，程序不写日志。所有人离开后房间消失，同一个暗号以后打开是一个新的空房间。
- **不留痕**：不用 Cookie 和本地存储，页面禁止缓存，关闭时让浏览器清除本站数据。没有外部资源，没有统计。
- **防篡改**：发送人、时间、消息编号都封在密文里，服务器单独无法改动发送人，也无法重放 10 分钟以前的旧消息。

**做不到的**（请务必知道）：

- 知道暗号的人都能进来。暗号越短越容易被猜中，重要的谈话用随机暗号。
- 服务器能看到 IP。要隐藏 IP，请配合可信的 VPN。
- 不能证明房间里的人是谁；输入法、截图、被监控的设备超出网页能保护的范围。
- 网页代码由服务器下发：部署者账号被盗，代码可能被替换。

完整说明见 [隐私与安全设计](docs/privacy.md)。

## 部署

任何人都可以免费部署自己的一份（[MIT 许可](LICENSE)），不需要我们同意。选一种：

| 你的情况 | 怎么做 | 说明书 |
| :--- | :--- | :--- |
| 没有服务器 | 点下面的按钮，部署到 Cloudflare（免费） | [Cloudflare](docs/manual/cloudflare.md) |
| 有境外 VPS 和域名 | `DOMAIN=chat.example.com docker compose up -d` | [VPS](docs/manual/vps.md) |
| 家里的电脑、NAS、树莓派 | Cloudflare Tunnel，不用开端口 | [家用设备](docs/manual/home.md) |
| 同一个 Wi-Fi、办公室、活动现场 | `npm run lan`，断网也能聊 | [局域网](docs/manual/lan.md) |
| 企业内网，不能上互联网 | 下载离线包，解压双击运行 | [企业内网](docs/manual/enterprise.md) |
| 只有一部安卓手机 | Termux 一行安装，开热点大家连上来 | [安卓手机](docs/manual/android.md) |
| 用 Tailscale | 私人内网，或免域名的公网网址 | [Tailscale](docs/manual/tailscale.md) |
| 不想管服务器 | Render、Koyeb、Railway 等一键部署 | [云平台](docs/manual/cloud.md) |

**最快：Cloudflare 一键部署**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Freecode100Year/private-talk)

登录 Cloudflare，按提示确认，几分钟后得到 `https://private-talk.<你的子域>.workers.dev`。

**一行 Docker（VPS）**

```sh
git clone https://github.com/Freecode100Year/private-talk.git && cd private-talk
DOMAIN=chat.example.com docker compose up -d      # 先把域名指向服务器，开放 80、443
```

**局域网 / 内网**

```sh
npm ci --omit=dev && npm run lan                  # 列出 https://192.168.x.x:8443/ 地址
```

不能上互联网的内网，从 [Releases](https://github.com/Freecode100Year/private-talk/releases/latest) 下载离线包（Windows、Linux、macOS，自带 Node.js；另有 Docker 离线镜像），U 盘拷进去解压即用。

**所有部署都要知道**：

- 必须 HTTPS，浏览器才允许网页加密。上面每种方式都已带好 HTTPS；局域网模式自动生成只能用于内网地址的证书。
- 用 http:// 打开时页面会提示无法使用。
- Node.js / Docker 版只能运行一个实例（房间在内存里）。
- 部署账号开启两步验证：它是这个网站的钥匙。

出了问题看 [故障排查](docs/manual/troubleshooting.md)。环境变量、目录结构和开发命令见 [参考](docs/reference.md)。

## 界面语言

自动跟随浏览器（简体中文、繁體中文、English），右上角可以切换。网站右上角的「使用说明」在内网断网时也能打开。

## 许可

[MIT](LICENSE)。任何人都可以自由使用、部署、修改和再分发，只需保留许可声明。
