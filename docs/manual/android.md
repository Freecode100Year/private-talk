# 安卓手机手册（手机当服务器）

**适合**：临时、小范围使用。活动现场开热点让大家连上来聊天；手边只有一部手机。
**结果**：局域网模式 `https://手机IP:8443`；或公网模式 `https://chat.你的域名`（Cloudflare Tunnel）。
**限制**：需要联网安装一次（Termux 和 Node.js）；耗电，要接充电器；不适合 24 小时长期运行。

## 1. 安装（需要互联网，只做一次）

1. 从 [F-Droid](https://f-droid.org/packages/com.termux/) 或 [GitHub](https://github.com/termux/termux-app/releases) 安装 **Termux**。不要装 Google Play 上的旧版本。
   要开机自启，再从同一来源装 **Termux:Boot**，并打开它一次。
2. 打开 Termux，粘贴运行：

   ```sh
   curl -fsSL https://raw.githubusercontent.com/Freecode100Year/private-talk/main/deploy/termux/install.sh | sh
   ```

3. 安卓 设置 → 应用 → Termux → 电池 → 选「不受限制」。否则锁屏后会被系统停掉。

## 2. 现场使用：开热点（局域网模式）

1. 手机打开热点，让大家连上。
2. Termux 里运行：

   ```sh
   ~/private-talk/deploy/termux/run.sh lan
   ```

3. 屏幕上会列出地址，例如 `https://192.168.43.1:8443/`。没有列出热点地址时，到热点设置里查看手机的 IP，然后：

   ```sh
   LAN_NAMES=192.168.43.1 ~/private-talk/deploy/termux/run.sh lan
   ```

4. 把地址告诉大家。第一次打开有证书提示，点「高级」→「继续前往」即可（原因见[局域网手册](lan.md#4-第一次打开的证书提示)）。

这种用法**不需要互联网**：热点没有流量、没有信号也能聊天。

## 3. 公网使用（Cloudflare Tunnel）

需要一个托管在 Cloudflare 的域名。

1. Cloudflare 后台 → Zero Trust → 网络 → 隧道 → 创建隧道（Cloudflared），复制令牌。
2. 公共主机名：子域名 `chat`，服务 `HTTP`，URL 填 `localhost:8080`。
3. Termux 里：

   ```sh
   echo '粘贴令牌' > ~/.private-talk-tunnel && chmod 600 ~/.private-talk-tunnel
   ~/private-talk/deploy/termux/run.sh tunnel
   ```

## 4. 开机自启

装了 Termux:Boot 后，手机重启会自动启动。默认是局域网模式，改成公网模式：

```sh
echo tunnel > ~/.private-talk-mode
```

## 5. 日常

- 停止：在 Termux 里按 Ctrl+C（音量下键 + C）。
- 升级：`cd ~/private-talk && git pull && npm ci --omit=dev`。
- 手机锁屏、换网络时连接会断几秒，聊天页会自动重连，2 分钟内回来编号不变。

## 6. 出问题

| 现象 | 做法 |
| :--- | :--- |
| 锁屏一会儿就断 | 电池设置改「不受限制」；部分国产系统还要在「自启动管理」「后台运行」里允许 Termux |
| 别人连上热点但打不开 | 用的是列出的地址吗？加 `LAN_NAMES=手机热点IP` 重新启动 |
| `pkg` 安装失败 | Termux 版本太旧（Play 商店版），改装 F-Droid 版 |

详细技术说明见 [docs/android.md](../android.md)。
