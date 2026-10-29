# Security model and boundaries

默认无口令：此文件包含完整房间密钥，请勿通过未加密的社交软件直接发送。持有文件的人可加入。可选口令包装无法彻底解决文件泄密；弱 PIN 可被离线暴力猜测，建议高熵密码，并通过独立渠道传递口令。本机尝试节流不能阻止离线猜测。

Master never reaches relay. WebSocket subprotocol access is sensitive bearer authentication visible to relay, reverse proxy, diagnostics and monitoring. Redact the entire Sec-WebSocket-Protocol header (including resume), never log secrets, disable third-party scripts/analytics and error reporting. Access is not an E2EE secret. Valid TLS certificates recommended. A WSS failure may be certificate trust or network/Origin/auth failure; browser API cannot distinguish. Visiting HTTPS may help inspect trust but cannot guarantee WSS works in every browser; never disable certificate verification.

Memory-only identities/messages/queues, no cookies/localStorage/IndexedDB, random session deviceId. Files saved by users necessarily persist master/wrapped master. Injectable storage adapter must be explicit and must not silently persist identities.

Meta CSP: default-src none; exact executable-script/style hashes, exact relay connect-src, no broad schemes, no blob images, no inline style attributes. Meta cannot enforce frame-ancestors, and cannot defend a replaced/tampered entire HTML. Verify file/script hashes through an independent trusted channel. JSON config is intentionally mutable per room and not executable.

Optional #hr1= entry can expose master to the hosting page's code; it is not equivalent to a verified offline file. No third-party code. Relay can deny, reorder, drop and misrepresent presence; safety code verification via independent channel matters. Shared master holders can introduce their own identities. No claim of anonymity against traffic analysis, protection on compromised devices, or independently audited ML-KEM.

Local file scripts/WebCrypto/WSS vary in iOS and WeChat/QQ previews. Real-device testing is mandatory before compatibility claims. Absent hardware must be marked unverified. Remote relay is still necessary. Do not deploy production as part of this task.

## 整合后的网页入口

`/hr.html` 是由服务端提供代码的生成器/入口，安全性依赖该站点代码。只使用本站脚本样式，connect-src self，无第三方分析；网页可读取 `#hr1=`，读取后会清除地址栏。已有会话不因新片段自动切房，须在新窗口打开。网页只为本站中继链接提供入房，其他中继可生成离线文件，但不提供可用的本站跳转。下载使用内存 Blob URL，仅用于文件下载，离开或重新生成后释放；没有开放 img-src blob。文件仍保持固定脚本/样式 hash CSP，不包含内联 style 属性。对整个网页或 HTML 的替换仍无法由其自身 CSP 防御。
