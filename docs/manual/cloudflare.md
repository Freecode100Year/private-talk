# Cloudflare 手册（没有服务器，最省事）

**适合**：个人或小团队，没有服务器，想几分钟内有一个自己的聊天网址。
**结果**：`https://private-talk.<你的子域>.workers.dev`，或绑定你自己的域名。
**费用**：免费版每天有用量上限（大约够房间累计活跃 29 小时），超出后当天无法进房；每月 5 美元的 Workers 付费版不会停。

## 需要下载什么

| 方法 | 需要下载 |
| :--- | :--- |
| A：网页一键部署 | **不用下载任何东西**，全程在浏览器里完成 |
| B：命令行 | [Node.js 22 或更新版本](https://nodejs.org/zh-cn/download)（选 LTS）；[Git](https://git-scm.com/downloads)，或者不用 Git，直接下载源码 [main.zip](https://github.com/Freecode100Year/private-talk/archive/refs/heads/main.zip) 解压 |

## 1. 准备

- 一个 Cloudflare 账号（免费注册）。
- 一个 GitHub 账号（一键部署会把代码复制到你的 GitHub）。
- 可选：一个已经托管在 Cloudflare 的域名。

## 2. 部署

**方法 A：网页一键部署**

1. 打开项目主页 <https://github.com/Freecode100Year/private-talk>，点 README 里的「Deploy to Cloudflare」按钮。
2. 登录 Cloudflare，按提示授权 GitHub、确认项目名（默认 `private-talk`）。
3. 等几分钟，页面会给出 `https://private-talk.<子域>.workers.dev` 网址，打开能看到首页就成功了。

**方法 B：命令行**（电脑上装有 Node.js 22 或更新版本）

```sh
git clone https://github.com/Freecode100Year/private-talk.git
cd private-talk
npm install
npx wrangler login              # 浏览器里登录 Cloudflare 并授权
npx wrangler deploy             # 部署，最后一行显示网址
```

## 3. 绑定自己的域名（可选）

Cloudflare 后台 → Workers 和 Pages → private-talk → 设置 → 域和路由 → 添加 → 自定义域，填 `chat.你的域名`。几分钟后 `https://chat.你的域名` 可用，证书自动签发。

绑定后可以在同一页面关闭 `workers.dev` 地址，只保留自己的域名。

## 4. 发给大家

把网址告诉使用者，并把[用户使用手册](user.md)发给他们。最简单的说法：

> 打开 `https://你的网址/#暗号`，暗号自己约定（只用数字、字母、中文），同一个暗号就进同一个房间。

## 5. 日常维护

不需要维护：没有服务器要管，没有数据要备份（本来就不存任何东西）。

- 用量：Cloudflare 后台 → Workers → private-talk → 指标，可以看请求数和 Durable Objects 用量。
- 免费版用量到上限当天会进不了房，第二天恢复。人多时开通 Workers 付费版（每月 5 美元）。

## 6. 升级

- 一键部署的：到你 GitHub 里的那个仓库，点「Sync fork」同步最新代码，Cloudflare 会自动重新部署。
- 命令行部署的：`git pull && npm install && npx wrangler deploy`。

## 7. 安全注意

- 你的 Cloudflare 账号就是这个网站的钥匙：开启两步验证。
- 如果域名开启了 Cloudflare Web Analytics 的自动注入，Cloudflare 会往网页里插入统计脚本。本项目的安全策略会拦截它，更干净的做法是在后台关掉该域名的自动注入。
- Cloudflare 能看到谁在什么时间访问了网站（IP 地址），看不到聊天内容。

## 8. 出问题

| 现象 | 做法 |
| :--- | :--- |
| 部署失败，提示需要 workers.dev 子域 | 新账号第一次用 Workers：后台 Workers 和 Pages 页面先设置一个 workers.dev 子域，再部署 |
| 平时正常，某天突然打不开或进不了房 | 免费版当天额度用完，第二天恢复；人多时开通 Workers 付费版 |
| 绑定域名后打不开 | 等几分钟证书签发；确认域名在同一个 Cloudflare 账号里 |

更多见 [故障排查](troubleshooting.md)。
