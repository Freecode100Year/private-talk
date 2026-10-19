# Cloudflare 手册（没有服务器，最省事）

**适合**：个人或小团队，没有服务器，想几分钟内有一个自己的聊天网址。
**结果**：`https://private-talk.<你的子域>.workers.dev`，或绑定你自己的域名。
**费用**：免费版有每日用量上限，超出后当天无法进房，第二天恢复；Workers 付费版（每月 5 美元起）包含更多用量、超出部分按量计费。实际用量取决于请求数和 Durable Objects 的运行时间，不能简单按“房间开了几小时”估算，请以后台指标为准（[Durable Objects 计费](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)），并在 Cloudflare 后台设置用量通知。

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
2. 登录 Cloudflare（没有账号就先免费注册，注册后回到这个按钮再点一次）。
3. 按页面提示连接你的 GitHub 账号：Cloudflare 会把项目**复制**一份到你的 GitHub（是独立的副本，不是 fork；以后升级用）。
4. 确认项目名（默认 `private-talk`，网址里会用到），其他选项保持默认，点「部署」/「Create and deploy」。
5. 等两三分钟，页面会给出 `https://private-talk.<子域>.workers.dev` 网址。
   新账号第一次用 Workers 时，会先让你起一个 `workers.dev` 子域名（例如你的英文名），填好再继续。

**方法 B：命令行**（电脑上装有 Node.js 22 或更新版本）

```sh
git clone https://github.com/Freecode100Year/private-talk.git
cd private-talk
npm install
npx wrangler login              # 浏览器里登录 Cloudflare 并授权
npx wrangler deploy             # 部署，最后一行显示网址
```

## 3. 确认部署成功

1. 用电脑打开部署得到的网址，看到首页。
2. 点「创建房间」→「创建私密房间」，再点「复制房间链接」，用手机打开这个链接。
3. 电脑上显示“2️⃣ 进入了房间”，两边互发一条消息能收到，就成功了。

## 4. 绑定自己的域名（可选）

Cloudflare 后台 → Workers 和 Pages → private-talk → 设置 → 域和路由 → 添加 → 自定义域，填 `chat.你的域名`。几分钟后 `https://chat.你的域名` 可用，证书自动签发。

绑定后可以在同一页面关闭 `workers.dev` 地址，只保留自己的域名。

## 5. 发给大家

把网址告诉使用者，并把[用户使用手册](user.md)发给他们。最简单的说法：

> 打开 `https://你的网址/#暗号`，暗号自己约定（只用数字、字母、中文），同一个暗号就进同一个房间。

## 6. 日常维护

不需要维护：没有服务器要管，没有数据要备份（本来就不存任何东西）。

- 用量：Cloudflare 后台 → Workers → private-talk → 指标，可以看请求数和 Durable Objects 用量。
- 免费版用量到上限当天会进不了房，第二天恢复。人多时开通 Workers 付费版（每月 5 美元）。

## 7. 升级

- **一键部署的**：你的仓库是副本，GitHub 上没有「Sync fork」。用仓库自带的升级流程：
  1. 打开你 GitHub 里的这个仓库 → **Actions** → 左侧 **upgrade** → **Run workflow**。
  2. 版本留空 = 最新发布；也可以填具体版本号（例如 `2.16.1`）。回退就填旧的版本号。
  3. 它会把仓库内容换成那个发布版本（只保留你的 Worker 名字），提交后 Cloudflare 自动重新部署。你自己往仓库里加的文件会被清掉。
  4. 第一次用时如果 Actions 页面提示要启用工作流，点启用即可。
  5. **想自动升级**：仓库 **Settings** → **Secrets and variables** → **Actions** → **Variables** → **New repository variable**，名字 `AUTO_UPGRADE`，值填 `patch`（每天自动装修补版本，例如 2.16.1 → 2.5.1，只有修复）或 `all`（所有新版本都自动装）。不设就不会自动升级。GitHub 会停用 60 天没有动静的仓库的定时任务，到时在 Actions 页面重新启用。
- **命令行部署的**：固定到发布版本，不要直接追 main：

  ```sh
  git fetch --tags && git checkout v2.16.1      # 换成要升级到的版本
  npm ci && npx wrangler deploy
  ```

  回退：`git checkout <旧版本号>` 后同样 `npm ci && npx wrangler deploy`。
- 确认：在任意装了 Node.js 22 的电脑上，进仓库目录运行 `node server/smoke.mjs https://你的网址`，两个测试客户端互发一条加密消息，最后一行应是 OK。
- 升级会让当时的房间重新开始（Durable Object 重新加载），页面自动重连，消息不会保留。

## 8. 安全注意

- 你的 Cloudflare 账号就是这个网站的钥匙：开启两步验证。
- 如果域名开启了 Cloudflare Web Analytics 的自动注入，Cloudflare 会往网页里插入统计脚本。本项目的安全策略会拦截它，更干净的做法是在后台关掉该域名的自动注入。
- Cloudflare 能看到谁在什么时间访问了网站（IP 地址），看不到聊天内容。

## 9. 卸载

Cloudflare 后台 → Workers 和 Pages → private-talk → 设置 → 拉到最下面「删除」。网站立即停止，没有数据需要清理。GitHub 里复制的仓库可以一并删除。

## 10. 出问题

| 现象 | 做法 |
| :--- | :--- |
| 部署失败，提示需要 workers.dev 子域 | 新账号第一次用 Workers：后台 Workers 和 Pages 页面先设置一个 workers.dev 子域，再部署 |
| 平时正常，某天突然打不开或进不了房 | 免费版当天额度用完，第二天恢复；人多时开通 Workers 付费版 |
| 绑定域名后打不开 | 等几分钟证书签发；确认域名在同一个 Cloudflare 账号里 |

更多见 [故障排查](troubleshooting.md)。
