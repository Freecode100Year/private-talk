# 云平台手册（Render、Koyeb、Railway、Zeabur、Fly.io）

## 需要下载什么

**不用下载任何东西**，全程在浏览器里完成，需要一个 GitHub 账号。只有 Fly.io 要在电脑上装它的命令行工具 [flyctl](https://fly.io/docs/flyctl/install/)。

这些平台都自带 HTTPS 和免费子域名。**都只开 1 个实例**（配置文件里已经写好）。免费套餐空闲时可能休眠，第一次打开要等十几秒。

房间在程序内存里，所以**只能有一个实例**。平台更新部署时，新旧两份可能短暂同时运行（各平台策略不同），这几秒内进房的人可能分到不同的“房间”，刷新即可。部署或升级后，在装了 Node.js 22 的电脑上进仓库目录（`npm ci` 之后）运行 `node server/smoke.mjs https://你的网址` 确认能聊天，最后一行应是 OK。

| 平台 | 做法 |
| :--- | :--- |
| Render | [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Freecode100Year/private-talk) 点按钮即可（读取 `render.yaml`） |
| Koyeb | [![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&repository=github.com/Freecode100Year/private-talk&branch=main&builder=dockerfile&name=private-talk&ports=8080;http;/&env[TRUST_PROXY]=1) 点按钮即可 |
| Railway | New Project → Deploy from GitHub repo → 选择本仓库（或你的复制）。会读取 `railway.json` 用 Dockerfile 构建；再到 Settings → Networking → Generate Domain，并在 Variables 里加 `TRUST_PROXY=1` |
| Zeabur | 新建项目 → 部署服务 → GitHub → 选择本仓库，会自动识别 Dockerfile；在网络里生成域名（端口 8080），环境变量加 `TRUST_PROXY=1` |
| Fly.io | 装好 `flyctl` 后在仓库目录运行 `fly launch --copy-config --no-deploy`（按提示改一个唯一的应用名），然后 `fly deploy --ha=false`（第一次部署也只开一台；`fly status` 确认只有一台机器） |


## 确认部署成功

1. 打开平台给的 `https://…` 网址，看到首页（免费套餐休眠时，第一次要等十几秒）。
2. 电脑和手机用同一个暗号进房间，互发消息能收到。

## 部署后

- 把平台给的 `https://…` 网址和[用户使用手册](user.md)发给使用者。
- 环境变量 `TRUST_PROXY=1` 让按 IP 的进房限速使用真实访客地址（Render、Fly.io 的配置文件里已写好）。
- 升级：平台连着 GitHub 时，同步你的仓库（Sync fork）后会自动重新部署。
- 平台运营方能看到访问记录，看不到聊天内容（见 [隐私与安全设计](../privacy.md)）。

## 卸载

在平台后台删除这个服务 / 应用（Render：Settings → Delete Web Service；Railway：Settings → Delete Service；Fly.io：`fly apps destroy 应用名`）。

更多见 [故障排查](troubleshooting.md)。
