# HTML Room V1 发布候选交付

仓库本地克隆：`/root/private-talk-html-room`；分支：`feature/html-room-chat`。未推送、未合并、未部署生产。原 `/root/private-talk` 未提交修改未覆盖。

基线：`3fc4378320e75f89566971ef3fcc1b2330c9eb8c`，远端默认分支 `main`。

| 阶段 | commit |
|---|---|
| 1 审计 | c609d338063ab3fcf433c3b6be4912147707e213 |
| 2 生成器 | 76c35f785e93ced45c098bec537d5955b6343366 |
| 3 中继与 v3 | da829113a2180b3bc906c7935099decf9dceaedb |
| 4 生命周期 UI | d65b2971090249b4857b3af858deac9defb14339 |
| 5 测试与修复 | 9ae6658252b4a0199faa554a3a2613f10bc5febf |
| 6 交付 | 本文所属 `docs(html-room): finalize release candidate and handoff` 提交；完整 SHA 见外部 delivery-manifest.txt / git log |

修改文件完整清单：changed-files.txt。协议、审计、安全边界分别见 protocol.md、architecture-audit.md、security-model.md。

## 构建与使用

Node 24.20.0，esbuild 固定 0.28.2，Playwright 固定 1.64.1。`npm ci --ignore-scripts`，然后：

```sh
# 最后一个参数是明确白名单；远程生产中继必须使用有效证书 WSS。
node scripts/build-html-room.mjs out/my-room.html wss://your-relay.example wss://your-relay.example
# 口令模式：从标准输入读取一行口令，避免命令行参数泄漏；请使用安全的本机交互输入渠道。
HR_PASSWORD_STDIN=1 node scripts/build-html-room.mjs out/my-wrapped-room.html wss://your-relay.example wss://your-relay.example
node scripts/check-html-room.mjs out/my-room.html out/my-wrapped-room.html
# 不传 relay 生成无秘密模板，不能直接聊天。
node scripts/build-html-room.mjs out/new-template.html
```

不会覆盖已有输出文件。单房间 HTML 默认权限 0600。生成文件保存在忽略目录 out，不进 Git。示例的 `relay.example` 是占位符，无法提供聊天服务；生产前须由操作者提供可访问中继。服务器/Worker 已支持独立 `/hr/<roomId>`；原游戏、公开大厅和 `/ws` 保留。

已完成 HTML 全量打包、Worker dry-run 构建、dist integrity（43 文件，unsigned，无发布签名私钥）、HTML 等效完整性验证。未运行 Docker 镜像构建或跨平台离线二进制发布，未部署。

## 产物与 CSP

| out 产物 | 字节 |
|---|---:|
| html-room-template.html，无秘密模板 | 43885 |
| html-room-example.html，无口令示例 | 44119 |
| html-room-wrapped-example.html，口令包装示例 | 44289 |

所有产物可执行内联脚本字节一致，SHA-256 hex：
`061b3b4b8c8a8a3e5fa3f582afa7cae6105f5dedecb78d4d8bfa698e3b774374`

CSP hash（base64）：`Bhs7S4yKij5fo/WCr6fK5hBfXe3st41Ni/ppjjt3Q3Q=`。
样式 hash：`tjnnYoX05TfNl+NsaNK4PRoAh8mTsDFSpuWgGDuoa88=`。
完整 HTML 哈希和逐产物 CSP 见 release-integrity.json。产物重新生成会改变随机房间配置及完整 HTML hash，但不改变脚本 hash。

CSP 检查通过：default-src none；脚本/样式仅明确 hash；connect-src 精确匹配白名单中继；无外部脚本/分析/图片、无内联 style 属性、无泛域名 scheme 或 blob 图片权限。meta CSP 不支持 frame-ancestors，不能保护被整体篡改的 HTML；须独立验证文件来源。

## 测试证据

- 原始基线 `npm test`：197/197 pass，fail/skip/cancel = 0。
- 最终 `npm test`：211/211 pass，fail/skip/cancel = 0，14.258 秒；包含全部原测试及 14 项新增测试。完整逐项名称见 node-test-results.txt。
- 14 项新增：HKDF 向量；口令/AAD/KDF 上限；CSP/白名单/hash；Origin/游戏帧过滤；结束标签/Unicode 转义；公告 IV/填充/篡改/房间 AAD；链签名消息/回执/重放/伪造；内存身份隔离；过期/重复公告；主机 CSP 注入；HTML 完整性篡改；跨离开/编号复用的身份固定；以及真实中继 Origin/旧 ws 与命名空间/seen h/游戏拒绝两项。
- Node 与本地 Worker 各一次真实 file:// Chromium E2E：分别 11 个场景检查通过。两个独立 BrowserContext；双向聊天；双方签名 seen；字面脚本文本无执行；仅预期 WebSocket；无额外 HTTP；零聊天页面 console/page errors；零 Cookie/localStorage/sessionStorage/IndexedDB；断线排队重连；错误口令不连中继与成功解锁；真实自签名 WSS 被拒绝且中文诊断显示（不关闭校验）。这不是手机模拟器或真机测试。
- Worker 本地策略另跑 2/2 pass。Miniflare 会在进入 Worker 前归一化同主机 Origin scheme，所以本地 Worker 此项不算原始协议差异的端到端证据；共享策略单元测试验证严格字符串比较，Node 实测协议差异拒绝。
- 初次浏览器测试等待消息超时：按执行策略降级至内存双会话，定位并修复空 owed 列表导致公告循环，然后恢复浏览器测试通过。首次全量回归暴露离线包遗漏新增模块，补齐 Docker/离线包/更新测试文件清单后通过；未删除失败测试。
- 独立审查发现并修复成员离开可绕过身份固定，以及停止后队列继续运行的问题；增加回归，复核无遗留 P1/P2。此审查不是密码学外部审计。

## 设备矩阵与限制

| 环境 | Node relay | Worker local | 真机 |
|---|---|---|---|
| Linux Chromium 156.0.8078.4，真实 file:// | 通过 | 通过 | 桌面无头浏览器 |
| iOS Safari 本地文件 | 未验证 | 未验证 | 无设备 |
| iOS 微信 / QQ 内置预览 | 未验证 | 未验证 | 无设备 |
| Android 微信 / QQ / 浏览器本地文件 | 未验证 | 未验证 | 无设备 |
| macOS Safari / Firefox / Edge | 未验证 | 未验证 | 无设备 |

无法保证本地 HTML 在 iOS/微信/QQ 预览中执行。当前未实现可选的托管 `#hr1=` 备用入口；未来实现时，网页代码可读 Fragment，不能视作验证过的离线文件。旧应用全套游戏 Playwright 场景未重跑；全部原 Node 回归已运行。

重要边界：文件持有人拥有加入能力；口令包装仍可离线猜测；共享 Master 持有人可引入身份；中继可观察 access/元数据并重放 bearer 鉴权、拒绝服务或伪报成员，接收确认须是签名 seen。Sec-WebSocket-Protocol 必须在反向代理、诊断和监控整头脱敏，关闭分析及错误上报。ML-KEM 实现未经独立审计。页面内存队列最多 20，展示 200 条、发送跟踪 100 条；不提供永久历史，重新加载会丢失。签名身份按整个会话固定，编号被不同身份复用会停机提示，需独立核实后重新打开。重连或重放不能保证消息必达；无回执不得声称客户端已确认。

依赖安装报告原有依赖漏洞 2 moderate / 1 high，本次未自动升级无关依赖。生产代理的脱敏/证书/监控配置与真实远程 WSS 尚需部署方验证。

仓库秘密检查：生成 Master、包装密文和测试 TLS 私钥未进入 Git；out/ 已忽略。hkdf-vector.json 是任务要求的公开 00..1f 字节测试向量，不是生产密钥。测试口令为公开测试文本；实际测试 Master 每次随机生成。交付包只含提交，不含 out 中的房间示例。

## 可迁移交付

外部目录 `/root/html-room-delivery`：增量 html-room-chat.bundle、完整 html-room-chat-full.bundle、六份 html-room-patches/*.patch、delivery-manifest.txt。完整 bundle 不要求接收方已有基线；已通过 bundle verify 和本地恢复核对。恢复请显式指定分支：`git clone -b feature/html-room-chat /root/html-room-delivery/html-room-chat-full.bundle private-talk`。未向远端推送。
