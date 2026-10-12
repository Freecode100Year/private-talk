# 局域网手册（家里、办公室、活动现场）

**适合**：大家在同一个网络里（同一个 Wi-Fi、同一个办公网、连同一个热点），只在这个网络里聊。
**结果**：`https://192.168.x.x:8443`，可以完全没有互联网。
**费用**：免费。

网络不能上互联网、没法下载安装？直接看[企业内网手册](enterprise.md)，用离线安装包。

## 1. 准备

一台在这个网络里常开的电脑（Windows / macOS / Linux），或者一部安卓手机（见[安卓手机手册](android.md)）。

## 2. 安装和启动

**方法 A：离线安装包（最简单，不用装任何东西）**

1. 从 [Releases](https://github.com/Freecode100Year/private-talk/releases/latest) 下载对应系统的包：Windows 选 `win-x64.zip`，Mac 选 `darwin-arm64`（Apple 芯片）或 `darwin-x64`（Intel），Linux 选 `linux-x64` 或 `linux-arm64`。
2. 解压。
3. Windows 双击 `start-lan.cmd`；Mac / Linux 在终端里运行 `./start-lan.sh`。

**方法 B：已经装了 Node.js 22 或更新版本**

```sh
git clone https://github.com/Freecode100Year/private-talk.git
cd private-talk
npm ci --omit=dev
npm run lan
```

**方法 C：Docker（Linux）**

```sh
git clone https://github.com/Freecode100Year/private-talk.git
cd private-talk
docker compose -f docker-compose.lan.yml up -d
docker compose -f docker-compose.lan.yml logs app     # 查看地址
```

启动后窗口里会列出地址，例如：

```text
同一网络里的人用浏览器打开：
  https://192.168.1.20:8443/
```

Windows 第一次启动时防火墙会弹窗，勾选「专用网络」并允许。

## 3. 发给大家

把列出的地址告诉大家，例如 `https://192.168.1.20:8443/#暗号`，并告诉他们第一次会有证书提示（见下一节）。用户怎么用见[用户使用手册](user.md)。

地址取决于电脑在这个网络里的 IP。IP 变了地址就变了，可以在路由器里给这台电脑设置固定 IP（DHCP 静态分配）。

## 4. 第一次打开的证书提示

浏览器会提示“连接不是私密连接”。原因：浏览器只在 HTTPS 下允许网页加密，而局域网地址拿不到公网证书，所以程序自己签发了证书。

- **临时使用**：点「高级」→「继续前往」。连接照样加密。
- **长期使用**：给各设备安装证书，见下一节。

## 5. 让设备不再提示证书

证书文件在程序目录的 `lan-certs/ca.crt`（Docker：`docker compose -f docker-compose.lan.yml cp app:/certs/ca.crt .`）。把它发到各设备并安装：

| 设备 | 安装方法 |
| :--- | :--- |
| Windows | 双击 `ca.crt` → 安装证书 → 本地计算机 → 将所有证书放入下列存储 → 受信任的根证书颁发机构 |
| macOS | 双击加入「钥匙串访问」的「系统」钥匙串 → 双击这个证书 → 信任 → 始终信任 |
| iPhone / iPad | 用 AirDrop 或「文件」打开 → 设置 → 已下载描述文件 → 安装；再到 设置 → 通用 → 关于本机 → 证书信任设置，打开它 |
| 安卓 | 设置 → 安全（或 安全和隐私）→ 更多安全设置 → 加密与凭据 → 安装证书 → CA 证书 |
| Firefox（所有系统） | 设置 → 隐私与安全 → 证书 → 查看证书 → 证书颁发机构 → 导入，勾选「信任由此证书颁发机构来标识网站」 |

**安装这个证书安全吗**：这个证书机构被限定为只能给局域网地址（`10.x`、`172.16–31.x`、`192.168.x` 等）和 `.local`、`.lan`、`.internal` 这类内部名字签发证书，**无法冒充任何互联网网站**，即使私钥泄露也一样。
`lan-certs` 目录里的 `ca.key` 要保管好，不要发给别人：拿到它的人可以冒充你这台局域网服务器。只发 `ca.crt`。

## 6. 日常维护

- 电脑要开着；关掉程序窗口（或 Ctrl+C）就停止，所有房间消失。
- 想开机自动运行：Windows 用「任务计划程序」在登录时运行 `start-lan.cmd`；Linux 见 [docs/offline.md](../offline.md) 里的 systemd 做法。
- 服务器证书一年多有效，到期前 30 天、或电脑 IP 变化时，重新启动程序会自动换新；各设备装的 `ca.crt` 十年有效，不用重装。

## 7. 升级

下载新版本的包，解压到新目录，把旧目录里的 `lan-certs` 文件夹复制过去，再启动。Node.js / Docker 方式：`git pull` 后重新启动。

## 8. 出问题

| 现象 | 做法 |
| :--- | :--- |
| 别人打不开地址 | 防火墙没放行 8443；或路由器开了「AP 隔离 / 访客网络」，设备之间不能互访 |
| 页面显示“这个网址不是 HTTPS” | 地址写成了 http://，改成 https:// |
| 列出的地址不对 / 没有地址 | 用 `LAN_NAMES=电脑的IP` 启动（Windows 在 start-lan.cmd 里加一行 `set LAN_NAMES=192.168.1.20`） |
| 装了证书还是提示 | 地址不在证书里（换了 IP 后要重启程序）；Firefox 要单独导入 |

更多见 [故障排查](troubleshooting.md)。
