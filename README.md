# Private Talk · HTML Room V1

**一个独立 HTML 文件，对应一个端对端加密聊天房间。**

生成文件后，把同一份文件交给参与者。在支持本地 HTML 脚本、Web Crypto 和 WebSocket 的浏览器中打开，点击进入，即可连接同一个房间；聊天仍需要可访问的中继服务。

本分支 `feature/html-room-chat` 是 **HTML Room V1 发布候选**，只新增文本聊天，不改造桌游。原网页聊天、公开大厅、游戏和 `/ws/` 路由保留。**尚未部署生产，iOS、微信、QQ 的本地文件预览尚无真机验证。**

[下载 RC1 与交付包](https://github.com/Freecode100Year/private-talk/releases/tag/html-room-v1-rc1) · [完整交付报告](docs/html-room/release-candidate.md) · [协议](docs/html-room/protocol.md) · [安全模型](docs/html-room/security-model.md)

## 先了解文件的含义

> **默认无口令：此文件包含完整房间密钥，请勿通过未加密的社交软件直接发送。**
>
> 任何拿到文件的人都可能加入房间。口令模式可以包装文件中的密钥，但持有文件的人仍可离线猜测口令；建议使用高熵密码，并通过独立渠道传递。它不能彻底解决文件泄密。

HTML Room 提供：

- 无注册、随机会话身份，默认无 Cookie、localStorage 或 IndexedDB。
- 中文文本聊天、基础在线状态、安全码、断线重连和有上限的内存消息队列。
- 两种文件模式：默认包含房间密钥；可选使用 PBKDF2 与 AES-256-GCM 口令包装。
- 复用 v3.2 链密钥、ECDSA 签名、ECDH 与 ML-KEM 混合协议，以及消息填充。
- 区分“已提交中继”和接收方的签名认证回执。“客户端确认”不等于对方本人已阅读。
- 独立 `/hr/<roomId>` 中继路由，拒绝游戏与大厅操作帧。

消息与身份默认只存在于本次页面内存中。关闭或刷新页面会丢失本地历史；重新打开文件仍可进入该房间，不会恢复旧消息。

## 获取本分支

需要 Node.js 22 或更高版本；交付测试使用 Node.js 24.20.0。

```sh
git clone --branch feature/html-room-chat --single-branch https://github.com/Freecode100Year/private-talk.git
cd private-talk
npm ci --ignore-scripts
```

也可以下载 RC1 的完整 bundle，在已有 Git 的电脑上恢复，无须预先拥有基线：

```sh
git clone -b feature/html-room-chat html-room-chat-full.bundle private-talk
```

**Release 中的 `html-room-template.html` 是无秘密模板，不能直接用来聊天。** 创建房间需要下面的生成器与中继地址。RC1 固定在其发布提交，分支 README 等后续更新不会自动改变该版本的附件。

## 本机体验：生成文件并双向聊天

先在一个终端启动本分支的 Node 中继：

```sh
HOST=127.0.0.1 PORT=8080 npm start
```

在另一个终端生成一个房间文件：

```sh
node scripts/build-html-room.mjs out/local-room.html ws://127.0.0.1:8080 ws://127.0.0.1:8080
node scripts/check-html-room.mjs out/local-room.html
```

用两个独立浏览器窗口或浏览器上下文打开 **同一份** `out/local-room.html`，分别点击进入，等待加密连接建立后发送消息。通过电话或其他独立渠道核对双方显示的安全码。

最后一个参数是生成时的中继白名单，必须明确填写。生成器不会覆盖已有文件。不要为每位参与者分别运行生成器：每次生成都会创建新的随机密钥，得到不同房间。

`127.0.0.1` 只指当前设备；此例不能让另一部手机连接你的电脑。远程使用请配置参与者都能访问的 WSS 中继。

## 远程使用与口令模式

先运行或部署本分支的中继代码，确保公开地址支持 `/hr/<roomId>`，并使用受信任的有效 TLS 证书。**不要假设旧版本中继或现有公开站点已经支持 HTML Room。**

无口令文件：

```sh
node scripts/build-html-room.mjs out/my-room.html wss://chat.example.com wss://chat.example.com
node scripts/check-html-room.mjs out/my-room.html
```

把示例域名替换为实际中继地址。生成器只接受精确的 WS/WSS 源，不接受用户名、密码、路径、查询参数或 Fragment；远程地址必须使用 `wss://`，明文 `ws://` 仅允许本机测试地址。本版本生成的文件连接源根路径下的 `/hr/`，不支持带秘密路径的 `ENTRY_PATH` 部署入口。

口令文件从标准输入读取一行口令，避免将口令写进命令行参数。以下为 Bash 交互示例，不把口令写入文件：

```bash
read -r -s -p '输入高熵房间口令：' room_password
printf '\n'
printf '%s\n' "$room_password" | HR_PASSWORD_STDIN=1 node scripts/build-html-room.mjs out/protected-room.html wss://chat.example.com wss://chat.example.com
unset room_password
node scripts/check-html-room.mjs out/protected-room.html
```

口令文件解锁成功之前不会进行敏感入房操作。页面提供错误口令处理与本机尝试节流；节流不能阻止持有文件的人离线猜测。

Node 中继入口是 `server/server.mjs`；Cloudflare Worker 入口是 `src/worker.js`，路由配置见 `wrangler.jsonc`。现有[部署手册](docs/manual/README.md)可用于了解服务器基础设置，但 HTML Room 路由、证书与代理配置仍需部署方单独验证。

## 安全边界与兼容性

| 项目 | 当前边界 |
|---|---|
| 中继能看到什么 | IP、连接时间、房间关系、帧大小，以及用于鉴权的 access；不能据此直接派生聊天密钥 |
| 鉴权材料 | `Sec-WebSocket-Protocol` 是中继可见的敏感 bearer 材料，代理、诊断和监控必须整头脱敏；它可以被重放，不能当作 E2EE 秘密 |
| 接收确认 | 中继回传仅表示提交；接收方经认证的链签名 seen 才算客户端确认 |
| 文件完整性 | 固定脚本哈希与 meta CSP 可限制资源执行；不能防御整个 HTML 被替换，也不能证明配置未被篡改 |
| 密码与设备 | 弱口令可离线猜测；无法防御被控制的设备、恶意输入法、参与者截图或复制 |
| 中继行为 | 中继仍可丢弃、延迟消息或伪报在线成员；不保证消息必达或网络匿名性 |
| 密码学审计 | 复用项目协议；ML-KEM 实现未经独立外部审计，不作额外安全保证 |

文件没有第三方脚本或分析代码。meta CSP 使用固定脚本、样式哈希和精确中继源，没有内联 style 属性；meta 不支持 `frame-ancestors`。请从可信渠道获取文件并独立核对完整性。

WSS 握手失败可能来自网络、Origin、鉴权或证书信任问题。建议使用有效证书；先访问对应 HTTPS 地址检查信任，也不能保证所有浏览器允许 WSS。**不要关闭证书校验。**

| 环境 | 验证状态 |
|---|---|
| Linux Chromium 156.0.8078.4，真实 `file://` | Node 中继和本地 Worker 均通过双向聊天 E2E |
| iOS Safari 本地文件 | 无真机，未验证 |
| iOS / Android 微信、QQ 内置文件预览 | 无真机，未验证；可能不执行 HTML 脚本 |
| Android 浏览器、macOS Safari、Firefox、Edge | 未验证 |

目前未实现可选的托管 `#hr1=` 备用入口。未来即使提供，网页入口代码也能读取 Fragment，其安全性不等同于经过验证的离线文件。

## 测试与可复现检查

RC1 的原始基线是 **197 项测试通过**；交付最终为 **211 项通过，失败与跳过均为 0**，其中新增 HTML Room 测试 14 项。Node 与本地 Worker 的真实文件 Chromium E2E 各通过 11 项检查；Worker 路由策略另通过 2 项。

```sh
npm test
npm run test:html-room
npx playwright install chromium
npm run test:html-room:browser
```

浏览器测试需要 OpenSSL，用于生成临时自签名证书并验证浏览器拒绝握手时的中文诊断。测试使用临时随机房间、两个独立浏览器上下文和本地中继；聊天页面额外 HTTP 请求、控制台错误与浏览器存储均为 0。预期的证书拒绝单独验证。

可执行内联脚本 SHA-256：

```text
061b3b4b8c8a8a3e5fa3f582afa7cae6105f5dedecb78d4d8bfa698e3b774374
```

不同房间的配置不同，但可执行脚本字节保持一致。上述 hash 对应本分支当前 HTML Room 实现及固定的 esbuild 0.28.2；[完整性清单](docs/html-room/release-integrity.json)包含 RC1 的样式与示例产物哈希。新生成房间的随机配置会改变完整 HTML 哈希。

| RC1 示例产物 | 大小 |
|---|---:|
| 无秘密模板 | 43,885 字节 |
| 无口令文件，使用占位中继源 | 44,119 字节 |
| 口令包装文件，使用占位中继源 | 44,289 字节 |

真实文件大小会随中继地址变化。生成的房间文件默认以 0600 权限写入 `out/`，该目录被 Git 忽略；不要把实际房间密钥、口令或测试私钥提交到仓库。

更多记录：[源码审计](docs/html-room/architecture-audit.md) · [逐项测试结果](docs/html-room/node-test-results.txt) · [修改文件清单](docs/html-room/changed-files.txt) · [发布候选交付报告](docs/html-room/release-candidate.md)。

## 原网页聊天与桌游

原功能仍保留在代码中，HTML Room V1 只提供聊天。原产品介绍见[主分支 README](https://github.com/Freecode100Year/private-talk/blob/main/README.md)；[English README](README.en.md)介绍的是原网页产品，尚未改写为 HTML Room 文档。

以下为原产品入口，不代表已部署本分支的 `/hr/` 中继，也不代表 HTML Room 的移动端兼容性已验证：

- [项目主页](https://freecode100year.github.io/private-talk/) · [原用户手册](docs/manual/user.md)。
- [iOS 捷径「隐匿对话」](https://www.icloud.com/shortcuts/196e890920d14049a2de8c813d5244d0)。
- [安卓联网版 APK](https://github.com/Freecode100Year/private-talk/releases/download/android-online-v2.20.0/PrivateTalk-online-v2.20.0.apk) · [联网版发布说明](https://github.com/Freecode100Year/private-talk/releases/tag/android-online-v2.20.0)。
- [安卓离线版 APK](https://github.com/Freecode100Year/private-talk/releases/download/android-offline-v17/PrivateTalk-offline-arm64-v17.apk) · [离线版发布说明](https://github.com/Freecode100Year/private-talk/releases/tag/android-offline-v17)。

## 许可

[MIT](LICENSE)。使用、修改和再分发时请保留许可声明。
