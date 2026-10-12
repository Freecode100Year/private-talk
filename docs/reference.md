# 参考：设置与目录

## 环境变量（Node.js / Docker 版）

| 变量 | 默认 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `8080`（局域网模式 `8443`） | 监听端口 |
| `HOST` | 所有地址 | 监听地址。放在本机反向代理后面时设为 `127.0.0.1` |
| `TRUST_PROXY` | 不信任 | 设为 `1` 时采用反向代理传来的 `X-Forwarded-For`（按 IP 限速）和 `X-Forwarded-Proto`（校验来源）。程序直接对外时不要开 |
| `JOIN_LIMIT` | `30` | 同一 IP 每分钟最多进房次数 |
| `MAX_CONNECTIONS` | `2000` | 整个服务同时在线的连接上限，超出的提示“进入次数太多” |
| `TLS_CERT`、`TLS_KEY` | 无 | 证书和私钥文件（PEM），设置后直接提供 HTTPS |
| `LAN_CERTS` | `./lan-certs` | 局域网模式的证书目录 |
| `LAN_NAMES` | 无 | 局域网模式额外写进证书的名字或地址，逗号分隔 |

Cloudflare 版的设置在 `wrangler.jsonc`：进房限速是 `ratelimits` 里的 `JOIN_LIMIT`。

## 目录

| 路径 | 内容 |
| :--- | :--- |
| `dist/` | 网页：`index.html`、`app.js`（界面与连接）、`i18n.js`（简体 / 繁体 / 英文）、`crypto.js`（密钥派生与加解密）、`state.js`（暗号与消息规则）、`help.html`（使用说明，由 `scripts/build-help.mjs` 生成）、`_headers`（安全响应头） |
| `src/worker.js` | Cloudflare Worker：静态资源 + `/ws/<房间>` WebSocket 转发（每个房间一个 Durable Object，不存储任何内容） |
| `src/rules.js` | 两种服务器共用的规则：人数、编号、发送间隔、限速 |
| `server/server.mjs` | Node.js 版服务器（Docker、VPS、局域网都用它），与 Worker 行为一致 |
| `server/lan.mjs`、`server/lancert.mjs` | 局域网模式与本机证书 |
| `Dockerfile`、`docker-compose*.yml`、`Caddyfile` | Docker 部署：自动 HTTPS、Cloudflare Tunnel、局域网、Tailscale |
| `deploy/` | systemd 服务文件、Caddy / nginx 示例、Tailscale 配置、安卓 Termux 脚本 |
| `offline/`、`scripts/offline-packages.sh` | 离线安装包 |
| `render.yaml`、`railway.json`、`fly.toml` | 云平台配置 |
| `docs/` | 说明书（`docs/manual/`）、隐私设计、各部署方式的技术细节 |
| `test/` | 规则、加密、防篡改、证书的单元测试 |
| `.github/workflows/` | 自动测试；构建 Docker 镜像和离线安装包 |

## 开发

```sh
npm test               # 单元测试（Node.js 22+）
npx wrangler dev       # 本地运行 Cloudflare 版
npm start              # 本地运行 Node.js 版（http://localhost:8080）
npm run lan            # 局域网模式（https://本机IP:8443）
npm run help           # 改了 docs/manual/user.md 后重新生成 dist/help.html
npm run deploy:freedom8964   # 部署 chat.freedom8964.com（本站维护者用）
```
