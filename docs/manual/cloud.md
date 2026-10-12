# 云平台手册（Render、Koyeb、Railway、Zeabur、Fly.io）

这些平台都自带 HTTPS 和免费子域名。**都只开 1 个实例**（配置文件里已经写好）。免费套餐空闲时可能休眠，第一次打开要等十几秒。

| 平台 | 做法 |
| :--- | :--- |
| Render | [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Freecode100Year/private-talk) 点按钮即可（读取 `render.yaml`） |
| Koyeb | [![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&repository=github.com/Freecode100Year/private-talk&branch=main&builder=dockerfile&name=private-talk&ports=8080;http;/&env[TRUST_PROXY]=1) 点按钮即可 |
| Railway | New Project → Deploy from GitHub repo → 选择本仓库（或你的复制）。会读取 `railway.json` 用 Dockerfile 构建；再到 Settings → Networking → Generate Domain，并在 Variables 里加 `TRUST_PROXY=1` |
| Zeabur | 新建项目 → 部署服务 → GitHub → 选择本仓库，会自动识别 Dockerfile；在网络里生成域名（端口 8080），环境变量加 `TRUST_PROXY=1` |
| Fly.io | 装好 `flyctl` 后在仓库目录运行 `fly launch --copy-config --no-deploy`（按提示改一个唯一的应用名），然后 `fly deploy`、`fly scale count 1` |


## 部署后

- 把平台给的 `https://…` 网址和[用户使用手册](user.md)发给使用者。
- 环境变量 `TRUST_PROXY=1` 让按 IP 的进房限速使用真实访客地址（Render、Fly.io 的配置文件里已写好）。
- 升级：平台连着 GitHub 时，同步你的仓库（Sync fork）后会自动重新部署。
- 平台运营方能看到访问记录，看不到聊天内容（见 [隐私与安全设计](../privacy.md)）。

更多见 [故障排查](troubleshooting.md)。
