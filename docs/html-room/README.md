# HTML Room V1：Claude / Codex 整合版

一个房间对应一个 HTML 文件。默认文件包含完整房间密钥；可选口令包装仍有离线猜测风险。远程聊天必须有可访问中继，手机预览兼容性未实测。

- [当前使用说明](../../README.md)：CLI、网页生成器、口令文件与备用网页入口。
- [合并报告](merge-report.md)：保留与移植的内容、协议冲突决策、本次实际测试结果。
- [当前协议](protocol.md)、[安全模型](security-model.md)、[当前脚本完整性清单](release-integrity.json)。
- [原 RC1 交付报告](release-candidate.md)、[Claude 原始报告](claude-report/test-report.md)：历史记录，不能作为本次整合验证的替代。

## 生成和核验

```sh
node scripts/build-html-room.mjs template
node scripts/build-html-room.mjs template --check
node scripts/build-html-room.mjs room --relay wss://your-relay.example --allow-relay wss://your-relay.example --out out/room.html
node scripts/verify-room-file.mjs out/room.html
```

口令仍使用 `HR_PASSWORD_STDIN=1` 从标准输入读取，不打印随机口令，也不把秘密放入命令行参数。多中继、命名房间与原 Claude 的 `v/name/relays/secret/lock` 配置未作为第二套协议保留；旧 Claude 文件不保证兼容，应使用整合版重新生成。

网页 `/hr.html` 提供本地生成、下载和本站中继的 `#hr1=` 链接。链接包含加入能力；网页代码可读取 Fragment。读取后清除地址栏，不将秘密发送到 HTTP 请求、日志或第三方分析。网页备用入口不等同于独立验证过的离线文件。

## iOS 打开文件后停在“正在自检”

“正在自检”是旧文件的静态占位文字；启动脚本执行后会立即替换它。若文字始终不变，说明脚本未成功启动，可能是文件预览禁用了 JavaScript、CSP 拦截或运行环境不兼容，并非口令校验正在进行。

在生成器中复制“房间链接”，粘贴到 Safari 地址栏，再输入口令。中继必须提供 `/hr.html` 网页入口；链接含加入能力，请通过可信渠道传递，勿提交到第三方文件转换或预览网站。

新版生成文件默认禁用口令输入与进入按钮，脚本成功启动并校验配置后才启用。脚本未运行时会保留浏览器打开说明，以及指向同一房间的静态网页链接。已有下载文件不会自动更新；可使用原生成器提供的房间链接进入原房间，或重新生成并让所有成员使用同一份新文件（重新生成会创建新房间）。

`npm run test:html-room:preview` 验证禁用脚本、CSP 阻止启动、链接保留同一口令房间及正常启动。此测试模拟不执行脚本的预览环境，不代表 iPhone 真机验证。
