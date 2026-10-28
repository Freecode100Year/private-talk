# 掼蛋与麻将实施计划

> 执行方式：按 executing-plans 逐项实现，两个独立规则引擎按 dispatching-parallel-agents 分配，最后独立代码审查。

**Goal:** 在现有公开桌提供可玩的掼蛋与血战入门麻将。
**Architecture:** 两个独立服务端规则引擎，统一秘密状态投影与路由，独立牌桌渲染。
**Tech Stack:** JavaScript、Node.js、Cloudflare Durable Objects、原生 DOM、node:test、Playwright。
**Spec:** `docs/superpowers/specs/2026-10-27-table-games-design.md`

## Global Constraints

- 保留用户工作区未提交内容；在独立 worktree 开发。
- 不新增账号、追踪、外部翻译/统计或长期玩家资料；聊天加密不改。
- 牌局行动绑定连接身份、gid 与 revision；绝不广播暗牌。
- 首版仅公开桌；麻将简化项明确显示；CI 未通过不部署。

## Review Focus

- 两副牌中同点同花色仍有不同 ID；伪造/重复 ID 不得出牌。
- 非当前玩家和迟到行动不能推进游戏；麻将响应窗口需要统一裁决。
- 重连与旁观者只能看到各自允许的信息，不能从快照、错误或序列化消息读牌墙。
- 清空房间删除全部裁判状态；有游戏时不能切换或开启第二局。
- 手机点选和异步快照更新不误打牌；错误明确保留手牌选择。

## Tasks

- [ ] 1. 掼蛋引擎：先写规则、投影、重复行动和完整对局测试并看到失败，再实现 `src/guandan.js` 与 `test/guandan.test.mjs`。按设计统一接口，测试过后提交。
- [ ] 2. 麻将引擎：先写胡牌、响应优先级、投影、恢复和完整对局测试并看到失败，再实现 `src/mahjong.js` 与 `test/mahjong.test.mjs`。按设计统一接口，测试过后提交。
- [ ] 3. 两后端接入：`src/card-table.js` 统一协调，修改 `server/server.mjs`、`src/worker.js`；先验证越权开局/跨游戏冲突与重连投影，再实现。Cloudflare 状态在休眠后恢复，房间空即删除。
- [ ] 4. 前端：`dist/card-table.js` 与 CSS 独立渲染；修改 `dist/modes.js`、`src/lobby.js`、`dist/app.js` 和翻译字典接入两玩法。先写浏览器流程验证四人入桌、行动、隐藏牌与手机点击，再实现。
- [ ] 5. 修复已复现的触屏测试判定问题；不单纯延长等待或忽略失败。验证实际动作是否被接受。
- [ ] 6. 核对规则说明与隐私文案，完整测试、独立审查、GitHub CI；仅通过后生成签名发布资产并逐站发布验证。记录未完成事项到每日方案与日报。


## 执行决策

- 浏览器套件原本串行约 20 分钟；改为 crypto/games/werewolf/mobile/lobby 五组并行，保留全部原测试并加入牌桌与触屏稳定性测试。每组独立服务，公开桌限流场景使用额外服务，避免测试相互消耗额度。
- 发布私钥仅在 GitHub Secret：新增只在 main 上、该准确 commit 的全套 test 工作流成功后才构建签名候选包的手动工作流。不会导出私钥；部署端验证签名与 commit，失败不发布。
