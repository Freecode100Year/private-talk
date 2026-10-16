# 隐匿对话

[English](README.en.md)

**iPhone / iPad**：[添加本项目的 iOS 捷径「隐匿对话」](https://www.icloud.com/shortcuts/196e890920d14049a2de8c813d5244d0)

**安卓**：[联网版 APK（0.9 MB，网页内置）](https://github.com/Freecode100Year/private-talk/releases/download/android-online-v2.5.0/PrivateTalk-online-v2.5.apk) · [离线版 APK（58 MB，arm64，免互联网，一部手机开热点当服务器）](https://github.com/Freecode100Year/private-talk/releases/download/android-offline-v3/PrivateTalk-offline-arm64-v3.apk)（说明与校验值：[联网版](https://github.com/Freecode100Year/private-talk/releases/tag/android-online-v2.5.0)、[离线版](https://github.com/Freecode100Year/private-talk/releases/tag/android-offline-v3)）

![隐匿对话 Private Talk：只给知道暗号的人，聊完不留痕](docs/images/banner.jpg)

**只给知道暗号的人。聊完，轻装离开。**

- **隐匿**：不要账号、不要手机号、不要昵称。消息在浏览器里加密，服务器只转发看不懂的密文，不保存消息，程序不写日志。
- **简单**：打开网址、输入暗号，就在同一个房间。不用装 App，手机电脑都能用。
- **不审查**：没有敏感词过滤、没有内容审核、没有举报和封号，也没有后门。服务器看不懂消息，也不按内容做任何判断；限制只有人数、发送频率和长度，用来防止被刷爆。
- **随处可部署**：Cloudflare 免费一键部署、一行 Docker、断网的局域网、不能上互联网的企业内网，甚至一部安卓手机。

在线使用：<https://chat.freedom8964.com>（Cloudflare）、<https://chat.nya.je>（独立 VPS，备用）　·　[iOS 捷径](https://www.icloud.com/shortcuts/196e890920d14049a2de8c813d5244d0)　·　[说明书](docs/manual/README.md)　·　[隐私设计](docs/privacy.md)

## 30 秒上手

1. 打开 `https://chat.freedom8964.com/#你们的暗号`。
2. 把这个网址发给朋友。
3. 打开同一个网址的人进入同一个房间，最多 25 人。

暗号可以用任何语言的文字和数字，不要符号。直接打开首页会随机生成一个无法猜中的暗号。人到齐后可以锁定房间，聊完关掉网页即可。详见 [用户使用手册](docs/manual/user.md)。

## 隐匿

| 谁 | 能看到 | 看不到 |
| :--- | :--- | :--- |
| 服务器运营方 | 你的 IP、上线时间、哪些连接在同一个房间 | 消息内容、暗号、你是谁 |
| 网络旁观者（运营商、Wi-Fi 管理者） | 你连了这个网站 | 内容、暗号、房间 |
| 房间里的人 | 消息，以及你的编号（1️⃣～🔟，之后 #11～#25） | 你是谁、你的 IP |

- **端对端加密**：密钥由暗号在浏览器里算出（PBKDF2 31 万次 → HKDF → AES-256-GCM）；加密前把消息补齐到固定几档长度，密文看不出一句话多长。2.4 起有**前向保密**：每人进房时生成临时密钥，每条消息一把一次性钥匙，有人离开全体换钥匙，事后拿到暗号也解不开当时录下的密文；侧栏显示安全码，大家核对一致就说明没人被调包。网站附带签名的文件清单，任何人都能用 `scripts/verify-site.mjs` 核对线上网页没被改过。暗号写在链接 `#` 后面，浏览器不会发给服务器，进入房间后立刻从地址栏抹掉。
- **没有暗号进不来**：服务器只认由暗号算出的进入凭证，只知道房间地址的人不能占座、锁房或发消息。
- **不留存**：没有账号、没有消息历史，程序不写日志。所有人离开后房间消失，同一个暗号以后打开是一个新的空房间。
- **不留痕**：不用 Cookie 和本地存储，页面禁止缓存，关闭时让浏览器清除本站数据。没有外部资源，没有统计。
- **防篡改**：发送人、时间、消息编号都封在密文里，服务器单独无法改动发送人；按每台设备自己的时间拒绝 10 分钟以前的旧消息。
- **房主管理**：最早进入的人是房主，人到齐后锁定房间、可以移出成员；房主离开自动由下一位接任。

**做不到的**（请务必知道）：

- 知道暗号的人都能进来，也能听到以后的对话。暗号越短越容易被猜中，重要的谈话用随机暗号。邀请链接不会过期。房间里有旧版本的成员时会退回没有前向保密的旧方式（页面会提示）。
- 服务器能看到 IP。要隐藏 IP，请配合可信的 VPN。
- 不能证明房间里的人是谁；对方可以截图、复制；输入法、被监控的设备超出网页能保护的范围。「清屏」只清你自己的屏幕。
- 网页代码由服务器下发：部署者账号被盗，代码可能被替换。可以用签名清单核对，但只针对某一个人的替换核对不出来；最稳妥是用安卓 App 或离线包。

完整说明见 [隐私与安全设计](docs/privacy.md)。

## 部署

任何人都可以免费部署自己的一份（[MIT 许可](LICENSE)），不需要我们同意。**大多数人从下面三种里选一种**，每种都有完整的安装、确认成功、升级、回退和卸载步骤：

| 你的情况 | 推荐做法 | 升级 | 说明书 |
| :--- | :--- | :--- | :--- |
| 没有服务器 | Cloudflare 一键部署（免费额度） | GitHub 里点 Actions → upgrade | [Cloudflare](docs/manual/cloudflare.md) |
| 有境外 VPS 和域名 | Docker + 自动 HTTPS：`./pt setup 你的域名` | `./pt upgrade`，失败自动回退 | [VPS](docs/manual/vps.md) |
| 断网的局域网、活动现场、企业内网 | 离线安装包（自带 Node.js），解压运行 `start-lan` | 新包拖到 `update` 上，不用联网 | [局域网](docs/manual/lan.md) · [企业内网](docs/manual/enterprise.md) |

**Cloudflare 一键部署**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Freecode100Year/private-talk)

登录 Cloudflare，按提示确认，几分钟后得到 `https://private-talk.<你的子域>.workers.dev`。

**VPS（Docker）**

```sh
curl -fsSL https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-compose.tar.gz | tar -xz
cd private-talk-docker && ./pt setup chat.example.com      # 先把域名指向服务器，开放 80、443
```

**局域网 / 内网**：从 [Releases](https://github.com/Freecode100Year/private-talk/releases/latest) 下载自己系统的离线包（Windows、Linux、macOS），U 盘拷进去解压，Windows 双击 `start-lan.cmd`，其他系统 `./start-lan.sh`。

<details>
<summary>其他方式（参考配置，按需使用）</summary>

| 情况 | 做法 | 说明书 |
| :--- | :--- | :--- |
| 家里的电脑、NAS、树莓派，不想开端口 | Docker + Cloudflare Tunnel | [家用设备](docs/manual/home.md) |
| 用 Tailscale | 私人内网，或免域名的公网网址 | [Tailscale](docs/manual/tailscale.md) |
| 不想管服务器 | Render、Koyeb、Railway、Zeabur、Fly.io | [云平台](docs/manual/cloud.md) |
| 只有一部安卓手机 | Termux，开热点大家连上来 | [安卓手机](docs/manual/android.md) |
| 已装 Node.js 22+ 的电脑 | `npm ci --omit=dev && npm run lan` | [局域网](docs/manual/lan.md) |

上面三种主推方式每次发布都在 CI 里自动验证（Cloudflare 运行时、Docker + Caddy、各系统离线包含更新与回退）；其他方式是经过测试的配置，但不在每次发布时实测各平台。

</details>

**所有部署都要知道**：

- 必须 HTTPS，浏览器才允许网页加密。上面每种方式都已带好 HTTPS；局域网模式自动生成只能用于内网地址的证书。
- 用 http:// 打开时页面会提示无法使用。
- Node.js / Docker 版只能运行一个实例（房间在内存里）；升级或重启会断开当时的聊天，页面会自动重连，但房间和消息不会恢复。
- 部署账号开启两步验证：它是这个网站的钥匙。
- 自己部署时可以设 `ENTRY_PATH` 开启**隐身入口**：网站只在秘密路径下打开，其他地址都回答普通的 404，扫描的人看不出这里是什么（见 [VPS 说明](docs/vps.md#隐身入口可选)）。

出了问题看 [故障排查](docs/manual/troubleshooting.md)。环境变量、目录结构和开发命令见 [参考](docs/reference.md)。

## 界面语言

自动跟随浏览器（简体中文、繁體中文、English、Español、বাংলা、Русский、العربية、Kreyòl Ayisyen、한국어、اردو、Français、हिन्दी），右上角可以切换。网站右上角的「使用说明」在内网断网时也能打开。

## 许可

[MIT](LICENSE)。任何人都可以自由使用、部署、修改和再分发，只需保留许可声明。
