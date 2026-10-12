# 局域网手册（家里、办公室、活动现场）

**适合**：大家在同一个网络里（同一个 Wi-Fi、同一个办公网、连同一个热点），只在这个网络里聊。
**结果**：一个 `https://192.168.x.x:8443` 这样的地址，同一网络里的人用浏览器打开就能聊。**可以完全没有互联网。**
**费用**：免费。

不能上互联网、没法下载？先在能上网的地方下载好安装包，再用 U 盘拷过去；完整的单位内网流程见[企业内网手册](enterprise.md)。

## 需要下载什么

**推荐：离线安装包**，自带 Node.js，解压就能用，不用装任何东西：

| 你的电脑 | 下载 |
| :--- | :--- |
| Windows 10/11（Windows 11 ARM 版也能用，系统自动转译） | [private-talk-win-x64.zip](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-win-x64.zip) |
| Mac，Apple 芯片（M1/M2/M3/M4…） | [private-talk-darwin-arm64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-darwin-arm64.tar.gz) |
| Mac，Intel 芯片 | [private-talk-darwin-x64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-darwin-x64.tar.gz) |
| Linux，x86_64 | [private-talk-linux-x64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-x64.tar.gz) |
| Linux，ARM 64 位（树莓派 64 位系统、鲲鹏等） | [private-talk-linux-arm64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-arm64.tar.gz) |
| 已装 Node.js 22 或更新版本（任何系统） | [private-talk-app.zip](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-app.zip) |

**不知道选哪个**：

- Mac：点左上角苹果菜单 →「关于本机」。“芯片”写 Apple M… 就选 Apple 芯片；写 Intel 就选 Intel。
- Linux：终端运行 `uname -m`。显示 `x86_64` 选 x64，显示 `aarch64` 选 arm64。
- 树莓派要装 64 位系统（Raspberry Pi OS 64-bit）。

用 Docker 的话见第 2 节方法 C。

## 1. 准备

- 一台在这个网络里、能一直开着的电脑当“服务器”（Windows、Mac、Linux、树莓派都行）。也可以是安卓手机，见[安卓手机手册](android.md)。
- 这台电脑和大家连的是**同一个网络**。
- 访客 Wi-Fi、带“AP 隔离”的 Wi-Fi 会禁止设备互相访问，要用主网络。

## 2. 安装和启动

### 方法 A：Windows（离线安装包）

1. 下载 `private-talk-win-x64.zip`。
2. 在下载的文件上点右键 →「全部解压缩」→ 选一个位置（例如 `C:\private-talk`）→「解压」。
   不要在压缩包里直接双击运行，要先解压。
3. 打开解压出来的文件夹（名字类似 `private-talk-2.0.0-win-x64`），双击 **`start-lan.cmd`**。
4. 如果出现“Windows 已保护你的电脑”：点「更多信息」→「仍要运行」。
5. 弹出 Windows 防火墙窗口时：勾选**「专用网络」**，点「允许访问」。
6. 黑色窗口里会列出地址，例如：

   ```text
   隐匿对话（局域网 / 内网）
   同一网络里的人用浏览器打开：
     https://192.168.1.20:8443/
   ```

7. **这个黑色窗口要一直开着**，关掉它聊天就停止了。可以最小化。

### 方法 B：Mac（离线安装包）

1. 下载对应芯片的 `.tar.gz` 包。Safari 一般会自动解压成文件夹；没有的话双击它解压。
2. 打开「终端」（启动台 → 其他 → 终端，或 Spotlight 搜“终端”）。
3. 输入 `cd `（cd 加一个空格），把解压出来的文件夹拖进终端窗口，回车。
4. 运行：

   ```sh
   ./start-lan.sh
   ```

5. 如果提示“无法打开，因为无法验证开发者”：打开「系统设置」→「隐私与安全性」，在下方找到提示，点「仍要打开」，再运行一次。
   也可以在终端里运行 `xattr -dr com.apple.quarantine .` 后再启动。
6. 弹出“是否允许 node 接受传入网络连接”时，点「允许」。
7. 终端里会列出地址。**终端窗口要一直开着。** 另外在「系统设置 → 电池 / 节能」里关掉自动睡眠。

### 方法 C：Linux / 树莓派（离线安装包）

```sh
tar -xzf private-talk-linux-x64.tar.gz      # 树莓派用 linux-arm64 的包
cd private-talk-*-linux-x64
./start-lan.sh
```

防火墙（如果开了 ufw）：`sudo ufw allow 8443/tcp`。
想开机自动运行，见[企业内网手册](enterprise.md#linux推荐作为系统服务)的 systemd 做法。

### 方法 D：已经装了 Node.js 22 或更新版本

```sh
git clone https://github.com/Freecode100Year/private-talk.git   # 或下载 private-talk-app.zip 解压
cd private-talk
npm ci --omit=dev
npm run lan
```

### 方法 E：Docker（Linux）

```sh
git clone https://github.com/Freecode100Year/private-talk.git
cd private-talk
docker compose -f docker-compose.lan.yml up -d
docker compose -f docker-compose.lan.yml logs app     # 查看地址
```

Docker Desktop（Windows/macOS）上：编辑 `docker-compose.lan.yml`，删掉 `network_mode: host`，把 `ports` 那一行前面的 `#` 去掉，并在 `LAN_NAMES` 填这台电脑的局域网 IP。

## 3. 确认部署成功

1. 在这台电脑自己的浏览器里打开 `https://localhost:8443/`，应该能看到首页（会有证书提示，见第 4 节）。
2. 用手机连上**同一个 Wi-Fi**，打开窗口里列出的 `https://192.168.x.x:8443/`。
3. 两边用同一个暗号进入房间，互发一条消息。能收到就成功了。

## 4. 第一次打开的证书提示

浏览器会提示“您的连接不是私密连接”或类似的话。这是正常的：浏览器只在 HTTPS 下允许网页加密，而局域网地址拿不到公网证书，所以程序给自己签发了证书。

- **临时使用**：确认地址是对的，点「高级」→「继续前往」（各浏览器的说法见[用户使用手册](user.md#10-内网地址的证书提示)）。连接照样是加密的。
- **长期使用**：给各设备装上证书，见下一节，以后就不再提示。

## 5. 让设备不再提示证书

证书文件在程序目录的 `lan-certs/ca.crt`（Docker：`docker compose -f docker-compose.lan.yml cp app:/certs/ca.crt .`）。用 U 盘、AirDrop、局域网共享等方式把 `ca.crt` 发到各设备，然后安装：

| 设备 | 安装方法 |
| :--- | :--- |
| Windows | 双击 `ca.crt` →「安装证书」→ 选「本地计算机」→「将所有的证书都放入下列存储」→ 浏览 →「受信任的根证书颁发机构」→ 确定 → 完成 |
| macOS | 双击 `ca.crt`，钥匙串选「系统」→ 在「钥匙串访问」里双击这个证书 → 展开「信任」→「使用此证书时」选「始终信任」→ 关闭窗口并输入密码 |
| iPhone / iPad | 用 AirDrop 或「文件」打开 `ca.crt` → 设置 →「已下载描述文件」→ 安装；再到 设置 → 通用 → 关于本机 → 证书信任设置，打开这个证书 |
| 安卓 | 设置 → 安全（或“安全和隐私”）→ 更多安全设置 → 加密与凭据 → 安装证书 →「CA 证书」→ 选 `ca.crt` |
| Linux（Debian/Ubuntu） | `sudo cp ca.crt /usr/local/share/ca-certificates/private-talk.crt && sudo update-ca-certificates` |
| Firefox（所有系统） | 设置 → 隐私与安全 → 证书 → 查看证书 → 证书颁发机构 → 导入，勾选“信任由此证书颁发机构来标识网站” |

**安装这个证书安全吗**：这个证书机构被限定为只能给局域网地址（`10.x`、`172.16–31.x`、`192.168.x`、`100.64–127.x`、`fc00::/7`）和 `.local`、`.lan`、`.internal`、`.home.arpa`、`localhost` 签发证书，**无法冒充任何互联网网站**，即使它的私钥泄露也一样。

`lan-certs` 目录里的 `ca.key` 要保管好，不要发给别人：拿到它的人可以冒充你这台局域网服务器。只发 `ca.crt`。

**卸载证书**：Windows 运行 `certmgr.msc` → 受信任的根证书颁发机构 → 证书 → 找到“隐匿对话 LAN CA …”删除；macOS 在「钥匙串访问」里删除；iPhone 在 设置 → 通用 → VPN 与设备管理 里删除描述文件；安卓在 加密与凭据 → 用户凭据 里删除。

## 6. 发给大家

把列出的地址告诉大家，例如 `https://192.168.1.20:8443/`，并告诉他们第一次会有证书提示。也可以直接给带暗号的链接 `https://192.168.1.20:8443/#暗号`。用法见[用户使用手册](user.md)。

地址里的 IP 是这台电脑在网络里的地址，路由器重启后可能会变。可以在路由器管理页面里给这台电脑设置**固定 IP**（通常叫“DHCP 静态分配”或“地址保留”）。

## 7. 常用设置

在启动前设置环境变量：

| 变量 | 作用 | Windows（写在 start-lan.cmd 里 node 那一行之前） | Mac / Linux |
| :--- | :--- | :--- | :--- |
| `PORT` | 端口，默认 8443 | `set PORT=9443` | `PORT=9443 ./start-lan.sh` |
| `LAN_NAMES` | 额外写进证书的名字或地址 | `set LAN_NAMES=192.168.1.20,chat.lan` | `LAN_NAMES=192.168.1.20 ./start-lan.sh` |
| `JOIN_LIMIT` | 每个地址每分钟最多进房次数，默认 30 | `set JOIN_LIMIT=100` | `JOIN_LIMIT=100 ./start-lan.sh` |

## 8. 日常维护

- **停止**：关闭窗口，或在窗口里按 Ctrl+C。所有房间随之消失。
- **开机自动运行**：Windows 用「任务计划程序」（见[企业内网手册](enterprise.md#windows-server)）；Linux 用 systemd。
- **证书**：服务器证书一年多有效，到期前 30 天、或电脑 IP 变化时，重新启动程序就会自动换新。各设备装的 `ca.crt` 十年有效，不用重装。
- **数据**：不存聊天记录，没有要备份的东西；只需保留 `lan-certs` 文件夹（换新版本时复制过去）。

## 9. 升级

1. 下载新版本的包，解压到一个新文件夹。
2. 把旧文件夹里的 `lan-certs` 文件夹复制到新文件夹里（这样各设备装的证书继续有效）。
3. 关掉旧窗口，从新文件夹启动。

Node.js 方式：`git pull && npm ci --omit=dev` 后重新启动。Docker：`git pull && docker compose -f docker-compose.lan.yml pull && docker compose -f docker-compose.lan.yml up -d`。

## 10. 卸载

关掉程序，删除解压出来的文件夹即可。程序没有安装任何东西，也没有改系统设置。各设备上装过的证书按第 5 节末尾的方法删除。

## 11. 出问题

| 现象 | 做法 |
| :--- | :--- |
| 别人打不开地址 | 防火墙没放行 8443；或路由器开了「AP 隔离 / 访客网络」，设备之间不能互访 |
| 页面显示“这个网址不是 HTTPS” | 地址写成了 http://，改成 https:// |
| 列出的地址不对 / 没有地址 | 用 `LAN_NAMES=电脑的IP` 启动 |
| 装了证书还是提示 | 地址不在证书里（换了 IP 后要重启程序）；Firefox 要单独导入 |
| 窗口一闪就关了（Windows） | 在文件夹地址栏输入 `cmd` 回车，再运行 `start-lan.cmd`，看报错文字 |
| 提示端口被占用（EADDRINUSE） | 换一个端口：`PORT=9443` |

更多见 [故障排查](troubleshooting.md)。
