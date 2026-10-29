> Claude 原始实现的历史报告，原样保留。不是当前整合版的验证结论；当前结果见 [合并报告](../merge-report.md)。原实现可在合并第二父提交 772f783 中查看。

# HTML Room 兼容性报告

只记录实际验证过的结果。没有在真实环境中跑过的一律标为“未验证”，下面“预期”一栏是依据，不是结论。

验证日期：2026-10-28，分支 `feature/html-room-chat`。

## 1. 已验证

| 环境 | 打开方式 | 中继 | 结果 | 方式 |
|---|---|---|---|---|
| Chromium 153.0.8010.0（Linux x86_64，无头） | `file://` 房间文件 | Node 中继（`ws://127.0.0.1`） | 通过：43/43 | `browser-tests/htmlroom.mjs` |
| 同上 | `file://` 房间文件 | Cloudflare Worker + Durable Object（本地 workerd，`wrangler dev`） | 通过：43/43 | 同一脚本，以 Worker 为中继 |
| 同上 | `http://127.0.0.1/hr.html#hr1=…` 网页入口 | Node 中继、Worker | 通过（同上脚本第 9–11 节） | 同上 |
| 同上 | 原有 `/ws/` 私密房间（回归） | Node 中继 | v3、verify、faults、receipts、lobby、phone、core 全部通过 | 现有 `browser-tests/` |
| Node.js 22（ws 客户端） | `/hr/`、`/ws/` 握手与转发规则 | Node 中继、Worker | 通过：各 9/9（Worker 上旧连接 4005 关闭帧一项见下注） | `test/hr-relay.test.mjs`、`test/hr-worker.test.mjs` |

注：在本地 workerd 上，用 resume 凭据重连时旧连接被替换，但旧连接的 4005 关闭帧没有及时到达客户端。`/ws/` 上行为相同，不是本分支引入的；该断言只在 Node 中继上检查。

Chromium 中 `file://` 页面是安全上下文，Web Crypto 可用，`Origin: null` 的 WebSocket 握手被 `/hr/` 接受，CSP 哈希、`connect-src` 白名单按预期生效（拦截有计数服务器对照验证）。

## 2. 未验证

本次环境的网络策略禁止下载 Playwright 的 Firefox、WebKit 构建，也没有真实手机，因此以下全部**未验证**：

| 环境 | 状态 | 预期（依据） |
|---|---|---|
| 桌面 Chrome / Edge（Windows、macOS） | 未验证 | 与 Chromium 同内核，预期可用 |
| 桌面 Firefox | 未验证 | `file://` 是安全上下文，预期可用；Firefox 对 `file://` 页面的 Origin 序列化需实测 |
| 桌面 Safari | 未验证 | Safari 15.4+ 支持所用 Web Crypto 与 BigInt；`file://` 下的 WebSocket 与 meta CSP 需实测 |
| Android Chrome 打开下载的 HTML 文件 | 未验证 | 取决于文件管理器是否用 Chrome 打开，以及是否以 `content://` 而非 `file://` 加载 |
| iOS Safari / “文件”App 预览 | 未验证 | “文件”App 的快速预览通常不执行脚本；页面会显示静态说明文字 |
| 微信、QQ 内置浏览器或文件预览 | 未验证 | 可能不执行脚本、改名或拦截 HTML 文件；不假设存在“用浏览器打开”选项 |
| 自签名证书的 `wss://` 局域网中继 | 未验证（真实浏览器） | 浏览器会静默拒绝；页面在连接失败时提示先在新标签页打开 `https://` 地址信任证书 |
| 真实 Cloudflare 生产环境 | 未验证 | 未部署；本地 workerd 已通过。部署需另行批准 |

## 3. 对移动端的判断

手机上直接打开 HTML 文件的成功率不确定，多数应用内预览不会执行脚本。移动端更可靠的入口是网页链接（`#hr1=`），代价是信任网站下发的代码（见 [security-model.md §4.2](security-model.md)）。生成器同时给出文件和链接。

## 4. 运行要求

- Web Crypto：HKDF、AES-256-GCM、ECDH P-256、ECDSA P-256、HMAC-SHA-256；加锁文件另需 PBKDF2-SHA-256。
- WebSocket、TextEncoder、BigInt（ML-KEM-768）。
- 页面在启动时逐项实测，缺任何一项显示中文说明，不降级。
- 中继需为本分支的 Node 中继或 Worker（`hello` 中带 `hr: 1`）。旧中继没有 `/hr/` 路径，握手失败，页面显示“无法连接中继”；若某个中继应答了 `hello` 却不带 `hr: 1`，页面显示“这个中继不支持 HTML Room”并停止。
