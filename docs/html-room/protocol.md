# HTML Room 协议 v1（`hr1`）

状态：V1，分支 `feature/html-room-chat`。本文件是规范性文档：不同客户端按本文实现必须得到相同的派生结果。

HTML Room 是“密钥从哪来”这一层的替换：两名用户拿到同一份 HTML 文件（或同一个 `#hr1=` 链接），不输入暗号、不注册，就进入同一个房间。房间之内的协议**完全复用**现有 v3.2（`dist/group.js`）：每人独立的发送链、一次性消息密钥、ECDSA 签名、ECDH + ML-KEM-768 混合成对密钥、离开即换钥、`pad()` 长度填充。本协议不引入新的消息加密方式。

## 1. 房间主秘密与派生

- **Master Secret（MS）**：32 字节，由 `crypto.getRandomValues` 生成。MS 只存在于房间配置中，任何时候都不发送给中继。
- 因为 MS 是 256 位随机值，不需要 PBKDF2 这样的慢哈希（现有暗号模式需要，是因为暗号可能很短）。

全部派生使用 HKDF-SHA-256，参数固定如下：

| 参数 | 值 |
|---|---|
| IKM | MS（32 字节） |
| salt | 32 个 `0x00` 字节（与现有 `crypto.js` 相同） |
| 输出长度 | 每个标签 32 字节 |
| info | 下表标签的 UTF-8 字节，无结尾符 |

| 标签（info） | 输出 | 用途 |
|---|---|---|
| `private-talk/html-room/v1/access` | `access`，32 字节，小写 hex 编码为 64 字符 | 只放在 WebSocket 子协议头里交给中继 |
| `private-talk/html-room/v1/key` | AES-256-GCM 房间密钥（不可导出） | 只用于封装 key announcement 和送达回执（§4） |
| `private-talk/html-room/v1/bind` | 32 字节 | 传给 `Group.create(key, bind, me)`，作为 v3 成对密钥 HKDF 的盐 |

**Room ID** = `hex(SHA-256(access))`，64 个小写 hex 字符。中继据此用现有的 `accessMatches()` 做常数时间校验：只知道 Room ID 的人算不出 `access`，因而无法占座、锁房或发消息。Room ID 不直接当作任何密钥使用。

### 1.1 已知答案测试向量（KAT）

```
MS      000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
MS(b64url) AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8
access  3b2fef5bc3101a05cda84d2c23afa7fb60b625318f7b9c294f1eb3144e7d82c9
roomId  ebd90a0af8117dc5fea74f7dff8d88b17d85faa25b304f578aa55dc57bcbb2bf
key     e2f20755efe99c2daf4d0ec4e5775a3054501b49fed4dc6f98e06132919c9332
bind    4e6f220de834d897a88da6b31bf17a2ae52f29ae2664b2edf653af4de933c3c0
```

这些值由 Node.js 内置 `crypto.hkdfSync` 独立算出，`test/html-room.test.mjs` 用浏览器同款 Web Crypto 实现逐项比对（`key` 一项通过对已知明文的加密结果比对）。

## 2. 房间配置

### 2.1 格式

配置是一个 JSON 对象。两种形式，字段集合各自固定，**出现任何未列出的字段即拒绝**：

无口令模式：

```json
{ "v": 1, "name": "周五晚饭", "relays": ["wss://chat.freedom8964.com"], "secret": "<MS 的 base64url，43 字符，无填充>" }
```

口令模式（§3）：

```json
{ "v": 1, "name": "周五晚饭", "relays": ["wss://chat.freedom8964.com"],
  "lock": { "kdf": "PBKDF2-SHA-256", "iter": 600000, "salt": "<16 字节 b64url>", "iv": "<12 字节 b64url>", "ct": "<48 字节 b64url>" } }
```

### 2.2 校验规则

| 字段 | 规则 |
|---|---|
| `v` | 必须是整数 `1`。其他值显示“版本不兼容”，不尝试解析其余字段 |
| `name` | 字符串，0–40 个 UTF-16 码元；不得包含 C0/C1 控制字符、U+2028/U+2029、双向控制符（U+202A–U+202E、U+2066–U+2069）、U+FEFF。只通过 `textContent` 显示，从不进入 HTML 或脚本 |
| `relays` | 1–4 个字符串，每个最长 200 字符，互不重复。每个必须能被 `URL` 解析，且：协议为 `wss:`；或协议为 `ws:` 且主机为 `localhost`、`127.0.0.1`、`[::1]`。不得含用户名、密码、查询串、片段。路径可为空或以 `/` 结尾的前缀（支持 `ENTRY_PATH` 部署） |
| `secret` | 恰好 43 个 base64url 字符，解码后 32 字节 |
| `lock` | 对象，字段恰好为 `kdf`、`iter`、`salt`、`iv`、`ct`；`kdf` 必须是 `"PBKDF2-SHA-256"`；`iter` 为 100000–5000000 的整数；`salt` 22 字符（16 字节）、`iv` 16 字符（12 字节）、`ct` 64 字符（48 字节），均为 base64url |
| 整体 | `secret` 与 `lock` 恰有其一；配置 JSON 的 UTF-8 长度不超过 4096 字节 |

客户端连接的地址为 `<relay 去掉结尾 />` + `/hr/` + Room ID。多个中继按顺序尝试，前一个连接失败才换下一个。

### 2.3 注入到 HTML

配置放在：

```html
<script id="pt-room-config" type="application/json">…</script>
```

序列化：`JSON.stringify(config)` 之后把 `<`、`>`、`/`、U+2028、U+2029 依次替换为 `<`、`>`、`/`、` `、` `（`&` 也替换为 `&`，防止被当作字符引用的组成部分）。结果仍是合法 JSON，解析后与原值完全相同，且不可能出现 `</script` 或 `<!--`。

客户端读取：`JSON.parse(document.getElementById('pt-room-config').textContent)`，再按 §2.2 校验。客户端不使用 `eval`、`new Function`、`innerHTML`、`insertAdjacentHTML` 或 `document.write`。

`type="application/json"` 的脚本块不会执行，也不参与 CSP 的 `script-src` 哈希，因此**所有房间文件中的可执行脚本逐字节相同**，哈希固定（见 §5）。

## 3. 口令模式

用于文件要经过不可信渠道（微信、QQ、邮件）传送的情况：文件里只有被口令加密的 MS，口令另行告知（当面、电话）。

生成：

1. `salt` = 16 字节随机，`iv` = 12 字节随机，`iter` = 600000。
2. `K` = PBKDF2-HMAC-SHA-256(口令的 UTF-8 字节（先做 NFC 规范化）, salt, iter) → 256 位 AES-GCM 密钥。
3. `ct` = AES-256-GCM(K, iv, MS, AAD)，其中
   `AAD = UTF-8(JSON.stringify(["private-talk/html-room/v1/lock", 1, name, relays]))`。
   AAD 用 JSON 数组编码：字段有定界、有转义、顺序固定，不存在拼接歧义。房间名或中继列表被改动后，正确的口令也解不开。

打开：显示口令输入框；用户输入后按同样参数派生并解密。解密失败一律显示“口令不正确，或文件已被改动”。连续失败不锁定（离线攻击者本来就不受界面限制，锁定只会妨碍正当用户）。

**口令模式的安全强度完全取决于口令。** 文件里有 salt 和密文，拿到文件的人（包括转发它的平台）可以离线穷举：

按单块高端 GPU 约每秒 1.5 万次猜测估算（hashcat 一类工具跑 PBKDF2-HMAC-SHA256 的公开基准折算到 60 万轮，只是量级）：

| 口令（随机生成时） | 约熵 | 穷举全部所需 |
|---|---|---|
| 6 位数字 | 20 bit | 约 1 分钟 |
| 8 位小写字母加数字 | 41 bit | 约 6 GPU·年（100 块 GPU 约 3 周） |
| 12 位（32 字符表，生成器的“随机口令”） | 60 bit | 约 240 万 GPU·年 |

人想出来的口令熵远低于同长度的随机口令。因此生成器要求口令至少 8 个字符，提供一键生成 12 位随机口令，并在界面上说明：6 位 PIN 只能防止“误点开”，不能防平台。

## 4. 线路格式

HR 客户端与中继之间的帧与现有 `/ws/` 协议相同（`src/rules.js` 的 `checkFrame`），子协议头为 `pt2, a<access>[, r<resume>]`。中继侧见 §6。

### 4.1 房间密钥封装（`key`、`seen` 帧）

现有 `crypto.js` 的 `seal()` 不带 AAD。HR 客户端对 key announcement 与送达回执改用：

```
AAD = UTF-8(JSON.stringify(["private-talk/html-room/v1/frame", roomId, type, from]))
type ∈ {"key", "seen"}；from = 发送者在本次连接中由中继分配的成员编号（整数）
密文 = AES-256-GCM(房间密钥, 随机 12 字节 IV, pad(UTF-8(明文 JSON)), AAD)
帧 = {"type": type, "iv": base64(IV), "ct": base64(密文)}   （标准 base64，满足中继的格式检查）
```

接收方用中继标注的 `from` 和本房间的 `roomId` 重建 AAD。效果：

- 中继改动 `from`（把 3 号的回执标成 5 号的）→ 认证失败。
- 另一个房间的帧被转发进来 → `roomId` 不同，认证失败；房间密钥本身也不同。
- 明文里的 `kind`、`from`、`id`、`t` 仍由 `checkKeys()` 再检查一遍（发送者一致、10 分钟时间窗、`id` 未见过）。

### 4.2 聊天消息（`msg` 帧）

完全按 v3.2：明文是 `state.js` 的 `envelope(from, text)`（`{from, id, t, text}`），交给 `Group.seal()`：

- 每条消息用发送链的下一把密钥（HMAC 步进），AAD 为 `pt3|<from>|<epoch>.<c>`；
- 明文末尾带发送者 ECDSA P-256 签名，覆盖 `pt31m|<from>|<h>|<text>`；
- 接收端 `Group.open()` 验签、按链位置拒绝回退（重放的旧位置打不开），`checkEnvelope()` 再检查 `from` 一致、时间窗、`id` 去重、长度（≤ 500 字符、≤ 2048 字节）。

**AES-GCM nonce**：每条消息的密钥只用一次，IV 为 12 字节随机。多名发送者从不共享消息密钥（各自的发送链来自各自的随机链密钥），因此不存在“多人从 0 开始计数导致 nonce 重复”的问题。房间密钥（§4.1）每次加密用随机 IV；按 NIST SP 800-38D 的随机 IV 上限（2³² 次）估算，一个房间内远达不到。

**跨房间**：成对密钥的 HKDF 盐是本房间的 `bind`，announcement 由本房间密钥封装且 AAD 含 `roomId`。别的房间的密文在任何一步都打不开。

**过大消息**：发送前 `checkMessage()` 截断检查，接收端 `checkEnvelope()` 拒绝；中继另有帧长上限（`MAX_FRAME`）。

### 4.3 送达回执（`DELIVERY_ACK`）

规范中的三种控制消息与本协议的对应：

| 规范名称 | 本协议 | 说明 |
|---|---|---|
| `PRESENCE_ANNOUNCE` | `key` 帧，`hello: true` | 加密的 announcement：签名公钥、ECDH 公钥、ML-KEM 公钥、给各成员的链密钥 |
| `PRESENCE_ACK` | `key` 帧，`hello: false` | 其他成员回送自己的链密钥 |
| `DELIVERY_ACK` | `seen` 帧 | 明文 `{"kind":"seen","v":"hr1","id","from","t","l":[[原发送者编号, "<epoch>.<c>"], …]}` |

接收端只有在 `Group.open()` 验签解密成功、`checkEnvelope()` 通过、并显示了消息之后，才把该消息排入回执。回执由 §4.1 封装，因此认证了：原消息（发送者编号 + 链位置，在发送者的链内唯一）、确认方编号（AAD 中的 `from`）、房间（AAD 中的 `roomId` 及房间密钥）、协议版本（`v: "hr1"` 及 AAD 首项）。

昵称：V1 不使用昵称，成员只显示中继分配的编号。中继不接触任何昵称。

## 5. 单文件 HTML 与 CSP

文件结构：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="…">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>…</title>
<style>…固定…</style>
</head>
<body>
<div id="pt-boot">…静态说明，脚本无法运行时可见…</div>
<script id="pt-room-config" type="application/json">…每个房间不同…</script>
<script>…固定…</script>
</body>
</html>
```

CSP（每个房间生成时只替换 `connect-src` 一项）：

```
default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none';
frame-src 'none'; worker-src 'none'; manifest-src 'none'; media-src 'none';
img-src 'none'; font-src 'none';
connect-src <各中继的 origin，空格分隔>;
style-src 'sha256-<固定>'; script-src 'sha256-<固定>'
```

- 不含 `unsafe-inline`、`unsafe-eval`、`unsafe-hashes`。模板中不使用 `style="…"` 属性和 `on*=` 事件属性。
- `connect-src` 只列出本房间配置的中继 origin（如 `wss://chat.freedom8964.com`），不使用 `wss:`、`https:` 这类协议通配。
- `<title>` 为固定的“隐匿对话 · 房间”，不含房间名（房间名不进入 HTML 结构的任何位置）。
- `frame-ancestors`、`sandbox`、`report-uri` 在 `<meta>` CSP 中无效（浏览器忽略）；文件模式下也无法用响应头补上。`base-uri`、`form-action` 在 meta 中生效，但模板本身不含表单和 `<base>`。

## 6. 中继：`/hr/<roomId>`

Cloudflare Worker 与 Node 中继新增同一路径，规则相同（`src/rules.js` 的 `relayPath` 和 `originAllowed`）：

| | `/ws/<roomId>`（原有） | `/hr/<roomId>`（新增） |
|---|---|---|
| 允许的 `Origin` | 仅同源 | 同源，或字面值 `null` |
| 其他 Origin（包括缺失） | 403 | 403 |
| 身份认证 | `access`（`accessMatches`） | 同左 |
| 速率限制 | 每地址每分钟加入次数 + 每连接帧预算 | 同左 |
| 房间命名空间 | `roomId` | `hr:` + `roomId`（Durable Object 名 / Node 的 Map 键），与原有房间互不相通 |
| `table`、`ref`、`file` 帧 | 处理 | 丢弃（不计坏帧） |
| 公开大厅 | 可列出 | 永远不会列出（大厅只登记 `/lobby` 创建的 roomId，不带 `hr:` 前缀） |
| `hello` | `files: true, lobby: true` | `files: false, lobby: false, hr: 1` |

`Origin: null` 不被视为可信：它只说明请求来自本地文件、沙箱 iframe 等不透明来源。原有同源检查的作用是防止别的网站借访客的浏览器连接中继；在 `/hr/` 上这一作用由 `access` 承担——不知道 MS 的网页拿不出 `access`。

## 7. URL Fragment 入口（`#hr1=`）

```
https://<受信任的网站>/hr.html#hr1=<base64url(UTF-8(配置 JSON))>
```

- 片段内容就是 §2 的同一份配置（含 `secret` 或 `lock`），用同样的规则校验。
- 网页客户端启动时第一件事是读取 `location.hash`，随后立即 `history.replaceState(null, '', location.pathname)` 清除地址栏，再做其他任何事。秘密不写入任何存储。
- 网页模式忽略配置中的 `relays`，只连接**本站**的 `/hr/`（CSP 为站点原有的 `connect-src 'self'`）。
- 网页模式依赖网站当时下发的脚本。这不等同于经过验证的离线文件，界面上会说明（见 `security-model.md`）。

## 8. 存储

所有存储经由 `createStorage()` 适配器，键格式 `pt_hr_v1_${roomId}_${keyName}`。V1 默认使用内存后端，不写 `localStorage`，不持久化任何内容（包括成员编号、设备密钥）。适配器在持久后端抛出 `SecurityError`、`QuotaExceededError` 或数据损坏时自动降级为内存，并通过 `persistent: false` 报告。
