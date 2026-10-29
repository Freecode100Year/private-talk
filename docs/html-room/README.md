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
