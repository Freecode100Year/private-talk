# 参考：设置与目录

## 环境变量（Node.js / Docker 版）

| 变量 | 默认 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `8080`（局域网模式 `8443`） | 监听端口 |
| `HOST` | 所有地址 | 监听地址。放在本机反向代理后面时设为 `127.0.0.1` |
| `TRUST_PROXY` | 不信任 | 设为 `1` 时采用反向代理传来的 `X-Forwarded-For`（按 IP 限速）和 `X-Forwarded-Proto`（校验来源）。程序直接对外时不要开。代理必须用访客的真实地址**覆盖**这个头，而不是接在访客自带的值后面，否则访客可以伪造地址绕过进房限速（自带的 Caddy 默认如此，nginx 示例写的是 `$remote_addr`） |
| `JOIN_LIMIT` | `60` | 同一 IP 每分钟最多进房次数 |
| `ENTRY_PATH` | 无 | 隐身入口：网站只在 `/<路径>/` 下打开，其他地址一律回答普通的 `404 page not found`（像一台空的 Go 网页服务器），扫描的人看不出这里是什么。8–64 个字母、数字、`-` 或 `_`。房间链接会带上这个路径。仅 Node.js / Docker 版；Cloudflare 版不支持 |
| `MAX_CONNECTIONS` | `2000` | 整个服务同时在线的连接上限，超出的提示“服务器连接数已满”（关闭码 4008） |
| `TLS_CERT`、`TLS_KEY` | 无 | 证书和私钥文件（PEM），设置后直接提供 HTTPS；两个要一起设，私钥必须和证书配对；文件更新后 10 分钟内自动载入 |
| `LAN_CERTS` | `./lan-certs` | 局域网模式的证书目录 |
| `LAN_NAMES` | 无 | 局域网模式额外写进证书的名字或地址，逗号分隔 |
| `CONFIG_FILE` | `./config.env`（有就读） | 设置文件：每行 `名字=值`，可用上面所有变量；已经在环境里设置的变量优先 |

启动时检查所有设置：数字不对、证书私钥不配对、文件不存在、`config.env` 里有不认识的名字，程序都会直接退出（退出码 2）并说明原因，不会悄悄改用默认值。

## 运维接口与命令

| 项目 | 说明 |
| :--- | :--- |
| `GET /healthz` | Node.js 版：`{"ok":true,"version":"…"}`，关闭中返回 503。不含房间或访客信息。Docker 的健康检查用 `node server/health.mjs` 访问它 |
| `node server/smoke.mjs <网址> [--insecure]` | 两个测试客户端进同一个随机房间，互发一条加密消息；证明 WebSocket、转发和加密都正常。Cloudflare 版和 Node.js 版都适用 |
| `node server/status.mjs` | 离线包的 `status`：版本、设置、证书到期、是否在运行 |
| `node server/update.mjs` | 离线包的 `update`：核对签名、试运行、替换、`--rollback`、`--import` |
| `./pt` | Docker 部署：`setup`、`status`、`upgrade`、`rollback`、`logs` |
| 停止 | 收到 SIGTERM 后不再接受新连接，用关闭码 1012 通知页面“服务器重启”，最多等 3 秒再退出；页面会自动重连 |

## 发布与签名

每个版本的发布页附带：各平台离线包、`private-talk-compose.tar.gz`（Docker 部署文件）、Docker 离线镜像、每个文件的 `.sig` 签名、`SHA256SUMS.txt` 和 `RELEASE-MANIFEST.txt`（版本、提交、协议、Node.js 版本、镜像 digest）。签名是 Ed25519，公钥是 `server/release-key.pem`，随每个包发布；离线更新程序用**已安装版本里的公钥**核对新包，所以不需要联网。发布后的附件不会被覆盖，修正发新的补丁版本。

网页本身也签名：部署（`npm run deploy`、`npm run deploy:freedom8964`）和构建 Docker 镜像、离线包时，`scripts/integrity.mjs` 把 `dist/` 里每个文件的 SHA-256 写进 `dist/integrity.json` 并用同一把发布密钥签名（没有密钥时写入未签名的清单）。任何人都可以从外部核对一个正在运行的网站：

```sh
node scripts/verify-site.mjs https://chat.freedom8964.com [--min-version 2.4.0]
```

它核对清单签名，再逐个下载文件比对哈希，并顺着页面的引用检查有没有清单以外的脚本。请从你信任的来源取得这个脚本和 `server/release-key.pem`。`.github/workflows/site-watch.yml` 每 6 小时对 chat.freedom8964.com 跑一次。

Cloudflare 版的设置在 `wrangler.jsonc`：进房限速是 `ratelimits` 里的 `JOIN_LIMIT`。

## 目录

| 路径 | 内容 |
| :--- | :--- |
| `dist/` | 网页：`index.html`、`app.js`（界面与连接）、`i18n.js` 与 `lang/`（界面文字，12 种语言）、`crypto.js`（密钥派生与加解密）、`group.js`（协议 v3：前向保密、签名、ML-KEM）、`game.js`（游戏「暗号潜伏」的规则与词库）、`escape.js`（游戏「密电逃脱」的出题、判定与规则）、`trade.js`（游戏「密约交易所」：配对、承诺与亮牌、计分）、`mission.js`（游戏「秘密任务」：词库、抽任务与承诺、核对、计分）、`picture.js`（图片：重新绘制去掉 EXIF、压缩、一次性密钥加密）、`vendor/mlkem.js`（ML-KEM-768，由 `scripts/build-mlkem.sh` 从 noble-post-quantum 打包）、`state.js`（暗号与消息规则）、`help.html`（使用说明，由 `scripts/build-help.mjs` 生成）、`_headers`（安全响应头） |
| `src/worker.js` | Cloudflare Worker：静态资源 + `/ws/<房间>` WebSocket 转发（每个房间一个 Durable Object，不存储任何内容） |
| `src/rules.js` | 两种服务器共用的规则：人数、编号、发送间隔、限速 |
| `server/server.mjs` | Node.js 版服务器（Docker、VPS、局域网都用它），与 Worker 行为一致 |
| `server/lan.mjs`、`server/lancert.mjs` | 局域网模式与本机证书（运行中自动续期） |
| `server/config.mjs` | 设置文件与启动检查 |
| `server/update.mjs`、`server/archive.mjs`、`server/status.mjs` | 离线更新程序、安装包读取、状态 |
| `server/smoke.mjs`、`server/health.mjs` | 聊天自检、健康检查 |
| `pt`、`.env.example` | Docker 部署的日常操作和设置模板 |
| `Dockerfile`、`docker-compose*.yml`、`Caddyfile` | Docker 部署：自动 HTTPS、Cloudflare Tunnel、局域网、Tailscale |
| `deploy/` | systemd 服务文件、Caddy / nginx 示例、Tailscale 配置、安卓 Termux 脚本 |
| `offline/`、`scripts/offline-packages.sh` | 离线安装包 |
| `render.yaml`、`railway.json`、`fly.toml` | 云平台配置 |
| `docs/` | 说明书（`docs/manual/`）、隐私设计、各部署方式的技术细节 |
| `test/` | 规则、加密、防篡改、证书的单元测试 |
| `browser-tests/` | 真浏览器测试：协议 v3.2（含 ML-KEM）、严格模式、核对安全码、25 人满员，服务器丢密钥帧、断线、人员快速进出等故障，以及与上一版（3.1）网页同房间互通（CI 每次运行） |
| `.github/workflows/` | 自动测试（三系统、Cloudflare 运行时、Docker + Caddy）；构建 Docker 镜像和离线安装包并签名；`site-watch.yml` 定时核对线上网页；`upgrade.yml` 给一键部署的副本升级用 |

## 开发

```sh
npm test               # 单元测试（Node.js 22+）
npx wrangler dev       # 本地运行 Cloudflare 版
npm start              # 本地运行 Node.js 版（http://localhost:8080）
npm run lan            # 局域网模式（https://本机IP:8443）
npm run help           # 改了 docs/manual/user.md 后重新生成 dist/help.html
npm run deploy:freedom8964   # 部署 chat.freedom8964.com（本站维护者用）
```
