# 企业内网手册（不能上互联网的内网）

**适合**：企业、学校、机构的 IT 管理员。内网与互联网隔离，服务器不能 `npm install`、不能 `docker pull`。
**结果**：`https://chat.内网域名` 或 `https://服务器IP:8443`，只在内网可用，全程不需要互联网。

## 1. 需要下载什么（在能上网的电脑上）

下面的链接总是指向最新版本，也可以到 [Releases](https://github.com/Freecode100Year/private-talk/releases/latest) 页面下载。所有文件名不带版本号，解压后的文件夹名带版本号（如 `private-talk-1.7.0-win-x64`）。

| 内网服务器 | 下载 |
| :--- | :--- |
| Windows Server / Windows 电脑 | [private-talk-win-x64.zip](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-win-x64.zip) |
| Linux（x86_64） | [private-talk-linux-x64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-x64.tar.gz) |
| Linux（ARM 64 位，如鲲鹏、飞腾、树莓派） | [private-talk-linux-arm64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-arm64.tar.gz) |
| Mac | [private-talk-darwin-arm64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-darwin-arm64.tar.gz)（Apple 芯片）或 [darwin-x64](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-darwin-x64.tar.gz)（Intel） |
| 只有 Docker 的服务器（x86_64） | [private-talk-docker-amd64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-docker-amd64.tar.gz) |
| 只有 Docker 的服务器（ARM 64 位） | [private-talk-docker-arm64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-docker-arm64.tar.gz) |
| 服务器已有 Node.js 22+ | [private-talk-app.zip](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-app.zip) |
| **每次都要下载** | [SHA256SUMS.txt](https://github.com/Freecode100Year/private-talk/releases/latest/download/SHA256SUMS.txt)（核对用） |

这些包自带官方 Node.js 和全部依赖，内网里不需要再下载任何东西。

## 2. 带进内网前的核对

多数单位要求核实软件来源，可以这样做：

```sh
sha256sum -c --ignore-missing SHA256SUMS.txt          # Linux / macOS
certutil -hashfile private-talk-win-x64.zip SHA256   # Windows，与 SHA256SUMS.txt 里的值对比
gh attestation verify private-talk-win-x64.zip -R Freecode100Year/private-talk   # 核验由本仓库源码在 GitHub 上构建
```

需要审计源码时，同一版本的源码在 Releases 页面的 Source code 附件里，构建脚本是 `scripts/offline-packages.sh` 和 `.github/workflows/offline.yml`。

程序的网络行为（供安全审批参考）：

- 只监听一个端口（默认 8443），提供网页和 WebSocket。
- 不主动连接任何外部地址，没有更新检查、统计、遥测。
- 页面不加载任何外部资源。
- 不写日志、不写数据库；只在证书目录里保存自己生成的证书。
- 聊天内容在浏览器里用 AES-256-GCM 加密，服务器只转发密文、不保存。

## 3. 安装

### Linux（推荐，作为系统服务）

```sh
sudo mkdir -p /opt/private-talk
sudo tar -xzf private-talk-linux-x64.tar.gz -C /opt/private-talk --strip-components=1
sudo useradd --system --no-create-home --shell /usr/sbin/nologin private-talk
sudo cp /opt/private-talk/deploy/private-talk-lan.service /etc/systemd/system/
sudo systemctl enable --now private-talk-lan
sudo journalctl -u private-talk-lan -n 20        # 查看访问地址
```

服务文件已做安全加固（只读系统、独立用户、无特权），证书保存在 `/var/lib/private-talk`。服务文件见仓库 [deploy/private-talk-lan.service](../../deploy/private-talk-lan.service)。

### Windows Server

1. 解压到 `C:\private-talk`。
2. 双击 `start-lan.cmd` 试运行，确认能打开。
3. 开机自动运行：任务计划程序 → 创建任务：
   - 常规：「不管用户是否登录都要运行」，勾选「使用最高权限运行」。
   - 触发器：启动时。
   - 操作：启动程序 `C:\private-talk\node\node.exe`，参数 `app\server\lan.mjs`，起始于 `C:\private-talk`。（升级时路径不变，不用改计划任务。）
   - 设置：取消「如果任务运行时间超过以下时间，停止任务」。
4. 防火墙放行入站 TCP 8443（只对内网网段）。

### Docker

```sh
docker load -i private-talk-docker-amd64.tar.gz
docker compose -f docker-compose.lan.yml up -d     # 文件在任一离线包里
```

## 4. 域名和证书（推荐用单位自己的）

**方案 A：用单位的内部 CA 证书（推荐）**

设备已经信任单位的根证书，就不会有任何提示。

1. 内网 DNS 加一条记录：`chat.内网域名` → 服务器 IP。
2. 向 IT/PKI 申请这个名字的服务器证书（PEM 格式的证书和私钥）。
3. 写进程序文件夹里的 `config.env`（Windows 同样适用），程序就直接用它，不再自己生成证书：

   ```sh
   TLS_CERT=/etc/private-talk/cert.pem
   TLS_KEY=/etc/private-talk/key.pem
   PORT=443
   ```

   证书和私钥不配对、文件不存在时，程序不会启动并说明原因；证书快过期会在启动时提醒。换了新证书文件不用重启，10 分钟内自动载入。systemd 也可以用服务文件里注释好的 `Environment=TLS_CERT=…` 行。用 443 端口时打开 `AmbientCapabilities=CAP_NET_BIND_SERVICE`。

**方案 B：用已有的反向代理**（nginx、F5、IIS ARR 等）

让代理提供 HTTPS 并转发到 `http://服务器:8080`，程序用 `HOST=127.0.0.1 TRUST_PROXY=1 node app/server/server.mjs` 启动（离线包里）。代理必须转发 WebSocket（`Upgrade`、`Connection` 头），并传 `Host`、`X-Forwarded-Proto`、`X-Forwarded-For`。nginx 示例：[deploy/nginx.conf](../../deploy/nginx.conf)。

**方案 C：用程序自己生成的证书**（没有内部 CA 时）

默认的 `lan.mjs` 会自动生成证书。用 `LAN_NAMES=chat.内网域名` 把内网域名也写进证书（内网域名需以 `.local`、`.lan`、`.internal`、`.home.arpa` 结尾，或直接用 IP）。然后把 `ca.crt` 批量下发到终端：

| 终端 | 批量下发方式 |
| :--- | :--- |
| Windows 域内电脑 | 组策略：计算机配置 → 策略 → Windows 设置 → 安全设置 → 公钥策略 → 受信任的根证书颁发机构 → 导入 `ca.crt`；单台：`certutil -addstore Root ca.crt` |
| macOS | MDM 下发证书描述文件；单台：`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca.crt` |
| Linux（Debian/Ubuntu） | 复制到 `/usr/local/share/ca-certificates/private-talk.crt`，运行 `update-ca-certificates` |
| Linux（RHEL/麒麟/统信） | 复制到 `/etc/pki/ca-trust/source/anchors/`，运行 `update-ca-trust` |
| iOS / Android 企业设备 | 通过 MDM 下发 CA 证书 |
| Firefox | 企业策略 `Certificates → ImportEnterpriseRoots: true`（使用系统证书库） |

这个 CA 带名称约束，只能为内网地址和内部名字签发证书，下发到终端不会给互联网网站带来风险。`ca.key` 只留在服务器上。

## 5. 确认部署成功

1. 在服务器上：`curl -k https://127.0.0.1:8443/ -o /dev/null -w "%{http_code}\n"` 应返回 `200`（Windows PowerShell：`curl.exe -k https://127.0.0.1:8443/`）。
2. 在一台员工电脑上打开内网地址，看到首页；页面没有红色的“不是 HTTPS”提示。
3. 两台电脑用同一个暗号进房间，互发消息能收到。
4. 第二个人进房后，第一个人旁边显示 👑（房主），能锁定房间。

## 6. 通知员工

把内网地址和[用户使用手册](user.md)发给员工。可以在内网门户放一个链接 `https://chat.内网域名/`。

## 7. 日常运维

- **状态**：`systemctl status private-talk-lan`；或访问首页返回 200。
- **容量**：每个房间最多 10 人，房间数不设上限。只传文字，资源占用很低；本项目没有做过大规模压力测试，人数很多时先观察服务器负载。
- **数据**：没有数据需要备份。服务重启时所有房间消失，用户重新打开链接即可回到（空的）房间。
- **只能运行一个实例**：房间保存在进程内存里，不要在负载均衡后面放多个实例。
- **访问控制**：用防火墙只允许需要的网段访问 8443 端口。
- **限速**：每个 IP 每分钟最多进房 30 次；终端经 NAT 或代理共用 IP 时，用 `JOIN_LIMIT` 调高。
- **连接上限**：默认最多 2000 个同时在线的连接，超出的会被提示“进入次数太多”；用 `MAX_CONNECTIONS` 调整。
- **房间管理**：最早进入的人是房主，可以锁定房间、移出成员；不需要管理员账号，服务器上也没有管理后台（不存在可以查看房间的地方）。

## 8. 升级（不需要联网）

每个离线包都带更新程序 `update`。它会核对签名、先在备用端口试运行新版本，正常才替换；证书、`config.env` 原样保留，上一个版本留在 `previous` 文件夹里可以一键回退。

1. 在外网下载**同一平台**的新安装包，以及同名的 `.sig` 签名文件（例如 `private-talk-linux-x64.tar.gz` 和 `private-talk-linux-x64.tar.gz.sig`），放在一起拷进内网。签名由本项目的发布密钥生成，内网里不用联网就能核对；包被改过一个字节都会被拒绝。
2. 停止服务：
   - Linux：`sudo systemctl stop private-talk-lan`
   - Windows：结束计划任务（或关闭窗口）。
3. 更新：
   - Linux：`sudo /opt/private-talk/update.sh /路径/private-talk-linux-x64.tar.gz`
   - Windows：把新安装包拖到 `C:\private-talk\update.cmd` 上，或在命令行运行 `update.cmd D:\private-talk-win-x64.zip`。
4. 启动服务，运行 `status`（`status.sh` / `status.cmd`）确认版本和“正在运行”。
5. 有问题：停止服务，运行 `update --rollback`，再启动。

程序路径不变，systemd 服务文件和计划任务都不用改。更新会断开当时的所有聊天；房间和消息在内存里，回退也不会恢复，大家重新打开房间链接即可。

**从 2.2 及更早版本升级（只需一次）**：旧版本没有更新程序。把新包解压到新文件夹，在新文件夹里运行 `update --import <旧文件夹>`，它会复制旧文件夹的 `lan-certs`，并把旧 `start-lan.cmd` 里的 `set` 设置写进 `config.env`。之后换成新文件夹运行（Linux 服务：把新文件夹放到 `/opt/private-talk`，`ExecStart` 改为 `app/server/lan.mjs`）。

**需要备份的东西**：没有聊天记录可备份，但请保留 `config.env`、`lan-certs`（或 `/var/lib/private-talk`）——其中 `ca.key` 是 CA 私钥，单独妥善保管；以及你自己的 `TLS_CERT`/`TLS_KEY`。

## 9. 卸载

- Linux：`sudo systemctl disable --now private-talk-lan && sudo rm /etc/systemd/system/private-talk-lan.service && sudo rm -rf /opt/private-talk /var/lib/private-talk && sudo userdel private-talk`
- Windows：删除计划任务，删除 `C:\private-talk`。
- 终端上下发过的 `ca.crt`：通过组策略 / MDM 撤回。

## 10. 合规提示

本系统的设计是**不留存任何聊天记录**：服务器只转发密文，用户关闭页面后内容即消失，管理员也无法查看或恢复。部署前请确认这符合单位关于通信留存、审计的规定。

## 11. 出问题

| 现象 | 做法 |
| :--- | :--- |
| 终端打不开 | 防火墙、网段 ACL；用服务器本机 `curl -k https://127.0.0.1:8443/` 确认程序在运行 |
| 页面提示“这个网址不是 HTTPS” | 用户用了 http:// 地址，或代理没有提供 HTTPS |
| 首页能打开，进房间一直“正在连接” | 代理或安全网关拦截了 WebSocket，放行 `/ws/` 路径的升级请求 |
| 已下发证书仍提示 | 访问用的名字或 IP 不在证书里：用 `LAN_NAMES` 加上后重启；或终端证书没装到“受信任的根证书” |

更多见 [故障排查](troubleshooting.md)。
