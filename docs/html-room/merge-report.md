> 历史范围说明：本文记录功能分支整合阶段。用户随后明确要求合入 main；主线整合见文末补充。

# Claude / Codex HTML Room 整合报告

目标分支仅 `feature/html-room-chat`，不合并 main，不部署生产。整合前父提交：Codex `d13d6d263cf95182474cd5caff9a8ba4a8472a22`，Claude `772f7836212482dbdfc76c00a48d7b961e4478ac`。合并提交记录两个父历史，Claude 的六份补丁及作者信息保留。

## 冲突与取舍

8 个冲突文件已逐项处理。没有把两套运行时并列公开；以已批准的 canonical 协议与安全修复为准：

| 保留/整合 | 具体结果 |
|---|---|
| Codex 协议、运行时 | HKDF 三标签与向量、310000 轮 PBKDF2、canonical 配置、公告封装、签名链消息及 seen、会话级身份固定及 halt 后队列停止 |
| Claude 网页生成器 | 改用同一套 crypto/session/client，提供高熵口令生成、下载、本站中继链接；不向后端提交秘密 |
| Claude Fragment 入口 | `#hr1=` canonical JSON base64url，严格大小/编码/配置校验，读取即清除，只允许本站中继；已有会话不自动切房 |
| Claude 模板与核验工作流 | `template [--check]` 构建/核对静态网页与模板；浏览器填充前验证整个空模板、脚本和样式 hash；核验 CLI 输出非敏感信息 |
| Claude 中继探针与 CI | Node/Worker 共用探针移植到 canonical access、预入房 403 和 seen.h；保留 CI 的模板检查、文件/网页 E2E 及 Worker 探针 |
| 原功能 | 原 Node 197 项基线测试保留；游戏、公开大厅、旧 /ws 路由不变；Node/Worker hello 为 HTML Room 增加 hr:1 标记 |

不保留为第二套活动协议的内容：Claude 的 `v/name/relays/secret/lock` 文件格式、共享 AEAD seen 回执、600000 轮/NFC 口令包装、多中继和命名房间。旧 Claude 文件不保证兼容，请重新生成。CLI 不认识的旧口令参数会显式拒绝，避免错误生成无口令文件。原源码与原测试可从合并第二父提交查看；原报告移至 claude-report 并标明历史来源。原 Claude 的 23 项单元测试和 43 项浏览器检查没有直接充当当前整合的测试结果。

## 本次实际验证

环境：Node 24.20.0、Linux、Playwright 1.64.1、Chromium 156.0.8078.4、esbuild 0.28.2。

- `HR_WORKER_TEST=1 WRANGLER_SEND_METRICS=false npm test`：**234/234 通过，失败/跳过/取消为 0**，16.479 秒。[逐项输出](merge-node-test-results.txt)。
- 默认 `npm test`：234 项，225 通过、9 Worker 探针按设计跳过；以上启用 Worker 的完整运行已覆盖这些跳过项。
- Node：真实 file:// 套件 11 项通过；网页生成器/Fragment 与 file:// 双向互通套件 9 项通过。验证下载的文件使用 canonical 配置、双方链签名回执、片段清除、无秘密进入 HTTP URL、无第三方请求、零 Cookie/localStorage/sessionStorage/IndexedDB、无效片段不连接以及随机高熵口令包装。
- 本地 Worker：上述真实 file:// 11 项与网页/文件互通 9 项均通过；Worker 专用路由探针 9 项也单独通过。Node/Worker 聊天页面控制台错误和第三方请求为 0。
- 自签名 WSS：真实浏览器拒绝未受信任证书，显示中文诊断；没有关闭证书校验。
- `node scripts/build-html-room.mjs template --check` 通过；浏览器填充文件与 CLI render 字节一致；修改脚本、样式、CSP 或模板 UI 会被拒绝。
- `node scripts/verify-room-file.mjs out/html-room-example.html` 通过；Worker dry-run 构建通过；dist integrity 47 文件，unsigned。
- 独立审查：保留 canonical 密码学与身份固定；发现模板周围 HTML 未固定的问题后，新增完整模板哈希和篡改回归，复核通过。

合并过程一次浏览器断言暴露同页 Fragment 导航不会重新初始化的问题，已加 hashchange 处理并通过同页跳转回归；该失败未被删除或当作通过。

## 整合时构建值（历史记录）

以下是主线整合时的值。后续 iOS 预览修复更新了模板和内联脚本；当前值以 [release-integrity.json](release-integrity.json) 为准。

固定内联可执行脚本 SHA-256：`2b6e8795dda3fda5f1ea5254646a250f677bc690b79823fde3152e9bccb7ca21`。
CSP base64：`K26Hld2j/aXx6lJUZGolD2d7xpC3mCP94xUum8y3yiE=`。
模板 44073 字节；占位 WSS 中继的无口令示例 44307 字节、口令示例 44477 字节。

完整值见 [release-integrity.json](release-integrity.json)。网页 hr.js 与单文件脚本是不同构建入口，所有房间文件的内联脚本仍一致。旧 RC1 hash 已保存在 rc1-integrity.json；原 GitHub RC1 附件不因本分支整合自动变化。

## 未验证与交付边界

没有 iOS、微信、QQ、Android 真机；不保证应用内预览执行脚本。没有运行生产 Cloudflare/远程 WSS、Docker 镜像构建或全套原游戏 Playwright 场景；不宣称这些已经验证。依赖审计原有 2 moderate / 1 high 未在本次无关升级。

文件持有人拥有加入能力；弱口令可离线猜测；网页代码能读取 Fragment；整个文件/网页被替换不受其自身 CSP 防护。中继可见 bearer access，Sec-WebSocket-Protocol 必须由代理/日志/监控整头脱敏。没有生产发布、main 合并或 Release 标签移动。实际房间示例在忽略的 out/ 中，不纳入源码提交。

## 主线整合补充

用户后续明确授权将整合版合入 main。以远端基线 `3fc4378320e75f89566971ef3fcc1b2330c9eb8c` 为第一父提交，合并已验证的 `2b63b2b91e9fc59001bc44852fe78bebbcd3a0d2`；README 的获取指令与主线状态同步更新。没有改变密码学或客户端代码，也没有移动 RC1 标签或手动执行聊天服务部署。远端推送仍需 GitHub workflow 权限；实际远端提交以执行结果为准。推送 main 将触发现有测试、镜像构建和 GitHub Pages 自动化。
