# HTML Room：一份文件就是一个加密房间

把一个 HTML 文件发给对方，两个人用浏览器打开同一份文件，不注册、不输入暗号，就在同一个端到端加密的聊天室里。房间之内是本项目现有的 v3.2 协议（前向保密、签名、ECDH + ML-KEM-768 混合），经由中继的 `/hr/` 路径转发。

| 文档 | 内容 |
|---|---|
| [protocol.md](protocol.md) | 协议 v1（`hr1`）：派生、配置格式、口令模式、线路格式、CSP、中继路径、KAT 向量 |
| [security-model.md](security-model.md) | 保护什么、不保护什么，“文件即钥匙” |
| [compatibility.md](compatibility.md) | 实际验证过的环境与未验证的环境 |
| [limitations.md](limitations.md) | 已知限制 |
| [test-report.md](test-report.md) | 测试结果 |
| [hashes.json](hashes.json) | 当前客户端脚本与样式的 SHA-256 |

## 创建房间

**命令行（推荐，不依赖网站）：**

```sh
# 加打开口令（随机生成，会打印一次）
node scripts/build-html-room.mjs room --relay wss://chat.freedom8964.com --name 周五晚饭 --random-pass --out room.html --web https://chat.freedom8964.com/

# 不加口令：文件本身就是钥匙
node scripts/build-html-room.mjs room --relay wss://chat.freedom8964.com --out room.html

# 自己的口令放在环境变量里（不进 shell 历史）
HR_PASS='…' node scripts/build-html-room.mjs room --relay wss://chat.example.org --pass-env HR_PASS
```

`--relay` 可以写多次（最多 4 个，按顺序切换）；局域网自建中继用 `wss://`，本机测试可用 `ws://localhost:8080`。`--web` 额外打印一个 `#hr1=` 网页链接。

**浏览器：** 打开部署了本分支的网站的 `/hr.html`，填写后下载文件、复制链接。生成在浏览器内完成，但生成器本身由网站下发。

## 发送与打开

- 无口令文件：只通过你信任的渠道传送（当面拷贝、端到端加密的通讯软件）。
- 口令文件：可以经过微信、邮箱等，**口令另外当面或电话告知**。
- 收到文件后可以先核对：`node scripts/verify-room-file.mjs room.html`。
- 用系统浏览器打开文件（Chrome、Edge、Firefox、Safari）。应用内预览通常不能运行；手机上打不开时用网页链接。
- 进房后在“成员与安全码”里和对方电话核对安全码。

## 开发

```sh
node scripts/build-html-room.mjs template        # 修改 dist/hr-*.js 或 hr.css 后重新生成模板
node scripts/build-html-room.mjs template --check
node --test test/html-room.test.mjs test/hr-relay.test.mjs
HR_WORKER_TEST=1 node --test test/hr-worker.test.mjs     # Worker（wrangler dev）
node browser-tests/htmlroom.mjs                            # 真浏览器，自带 Node 中继
```

模板只由这些文件内联而成：`crypto.js`、`vendor/mlkem.js`、`group.js`、`state.js`、`hr-core.js`、`hr-room.js`、`hr-file.js`、`hr.css`。改动任何一个都会改变脚本哈希，`hashes.json` 随之更新。
