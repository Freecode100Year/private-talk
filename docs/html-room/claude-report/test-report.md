> Claude 原始实现的历史报告，原样保留。不是当前整合版的验证结论；当前结果见 [合并报告](../merge-report.md)。原实现可在合并第二父提交 772f783 中查看。

# HTML Room 测试报告

日期：2026-10-28 · 分支 `feature/html-room-chat` · Node.js 22.23.4 · Chromium 153.0.8010.0（Linux x86_64，无头）

客户端脚本 `sha256-NUAFpVw6Lf+j3wKUuXIgE8NMzhwHb9SNBPlfuyAcW8Q=`，样式 `sha256-uYWw4CqsQrzZ2AzIdNrpxho7syPttx/5chKJkOuwcxs=`。

## 1. 汇总

| 测试 | 结果 |
|---|---|
| `npm test`（全部单元测试，含原有 197 项：196 通过、1 跳过） | 240 项：230 通过、0 失败、10 跳过（原有 1 项 + Worker 探针 9 项，默认需 `HR_WORKER_TEST=1`） |
| `test/html-room.test.mjs` | 23/23 通过 |
| `test/hr-relay.test.mjs`（Node 中继） | 10/10 通过 |
| `HR_WORKER_TEST=1 test/hr-worker.test.mjs`（Worker，本地 workerd） | 9/9 通过 |
| `browser-tests/htmlroom.mjs`，Node 中继 | 43/43 通过 |
| `browser-tests/htmlroom.mjs`，Worker 中继（wrangler dev） | 43/43 通过 |
| 原有浏览器测试 v3、verify、faults、receipts、lobby、phone、core（Node 中继） | 全部通过 |
| `build-html-room.mjs template --check` | 通过 |

未运行：原有浏览器测试中的 `mixed`（需要完整 git 历史中的旧版本文件，本次是浅克隆）以及 game、escape、trade、mission、pictures、werewolf、wwtable、taps、dice、switch、full25（耗时长，且本分支未改动其代码路径；CI 的 `browsers` 任务会运行）。

## 2. 规范 §7 要求的专项测试

| 要求 | 位置 | 结果 |
|---|---|---|
| `</script>` 配置注入 | 单元：safeJson、fillTemplate；浏览器第 4 节 | 通过 |
| CSP 恶意外联阻止 | 浏览器第 3 节（本地计数服务器 0 命中 + 无 CSP 对照有命中） | 通过 |
| `Origin: null` 专用端点握手 | 中继探针（Node + Worker） | 通过 |
| 原有端点 Origin 策略回归 | 中继探针：`/ws/` 拒绝 `null` 与缺失 Origin、接受同源 | 通过 |
| `localStorage` 抛出 `SecurityError` | 单元：存储适配器；浏览器第 7 节 | 通过 |
| 跨房间存储隔离 | 单元：存储适配器 | 通过 |
| Web Crypto 缺失时的中文错误界面 | 浏览器第 6 节（去掉 `crypto.subtle`、去掉 `WebSocket`） | 通过 |
| HKDF 已知答案测试向量 | 单元：与 Node `hkdfSync`、`aes-256-gcm` 独立比对 | 通过 |
| 多发送者 AES-GCM nonce 唯一性 | 单元：3 人各 40 条，消息密钥与 IV 全不重复，链起点互不相同 | 通过 |
| AAD 字段篡改拒绝 | 单元：链位置、密文、发送者标签、房间帧的 roomId/类型/发送者 | 通过 |
| 重放消息拒绝 | 单元：同一消息二次、旧链位置、相同 id、11 分钟前的消息 | 通过 |
| ACK 伪造、重复、延迟、乱序 | 单元：AAD 伪造、明文 from 不符、重放、早于回传、非目标成员、失败后 | 通过 |
| 在线成员重复连接 | 中继探针：resume 替换旧连接、成员列表单一；浏览器第 10 节：刷新后列表与离开通知 | 通过 |
| Fragment 不进入 HTTP 请求 | 浏览器第 9 节：网页入口所有请求 URL 不含 `#` 或秘密 | 通过 |
| Fragment 不进入服务器日志 | 中继本身不记录请求（原有设计）；结合上一项为**间接验证**，未单独抓取服务器输出 | 间接验证 |
| Fragment 秘密不进入第三方请求 | 浏览器第 9 节：网页入口只请求本站；所有帧不含秘密 | 通过 |
| 实际 `file://` 页面运行 | 浏览器第 1–8、10–11 节 | 通过（Chromium） |
| Android / iOS 真实环境 | — | **未验证**（无设备） |

## 3. 额外覆盖

- 口令文件：错口令中文提示、改房间名/中继后无法解锁、NFC 规范化、两页面解锁后同房聊天。
- 离开者在换钥后读不到新消息。
- 损坏 JSON、未知字段、版本不兼容、超长名称、无效中继地址的中文错误页。
- 浏览器内生成器下载的文件：CSP 只列出其中继，`file://` 打开后能连接。
- `verify-room-file.mjs`：接受发布的房间文件；拒绝改脚本、加脚本、放宽 `connect-src`、加 `unsafe-inline`、换中继、加标记、改样式。
- 模板 CSP 不含 `unsafe-*` 与协议通配，无内联 style/事件属性；客户端源码不含 `eval`、`new Function`、`innerHTML`、`document.write`、Web Storage。

## 4. 测试环境说明

本次会话的网络策略禁止访问 `cdn.playwright.dev`，Playwright 的浏览器改用 npm 包 `@sparticuz/chromium` 提供的 Chromium 二进制（`CHROMIUM_PATH` 指定）。CI 中仍使用 `npx playwright install chromium` 的标准构建。CI 本身在本次会话中**未运行**。
