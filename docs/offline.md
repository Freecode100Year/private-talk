# 离线安装（不能连接互联网的内网）

> 面向 IT 管理员的完整步骤（核对、安装为服务、证书下发、运维、升级）见 [企业内网手册](manual/enterprise.md)。

企业、学校、现场的内网往往不能上互联网，没法 `npm install`、`docker pull`。每个版本的 [Releases](https://github.com/Freecode100Year/private-talk/releases/latest) 都附带离线安装包：在能上网的电脑上下载，用 U 盘或内网文件服务器拷进去即可，**内网里不需要下载任何东西**。

| 文件 | 适用 | 用法 |
| :--- | :--- | :--- |
| [private-talk-win-x64.zip](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-win-x64.zip) | Windows 10/11 | 解压，双击 `start-lan.cmd` |
| [private-talk-linux-x64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-x64.tar.gz) | 普通 Linux 服务器 / 电脑 | `tar xzf …`，运行 `./start-lan.sh` |
| [private-talk-linux-arm64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-linux-arm64.tar.gz) | ARM 服务器、树莓派（64 位系统） | 同上 |
| [private-talk-darwin-arm64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-darwin-arm64.tar.gz) | Apple 芯片的 Mac | 同上 |
| [private-talk-darwin-x64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-darwin-x64.tar.gz) | Intel 芯片的 Mac | 同上 |
| [private-talk-app.zip](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-app.zip) | 已装 Node.js 22 或更新版本的机器 | 解压，`node server/lan.mjs` |
| [private-talk-docker-amd64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-docker-amd64.tar.gz) | 有 Docker 的 x86 服务器 | 见下文 |
| [private-talk-docker-arm64.tar.gz](https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-docker-arm64.tar.gz) | 有 Docker 的 ARM 服务器 | 见下文 |

前五个包自带 Node.js（官方 nodejs.org 的版本，构建时按官方校验和核对）和全部依赖，解压即用，不需要安装，也不改系统设置。启动后列出的地址、证书提示的处理见 [docs/lan.md](lan.md)，包里的 `使用说明.txt` 是简要版。

## Docker 离线镜像

```sh
docker load -i private-talk-docker-amd64.tar.gz
docker compose -f docker-compose.lan.yml up -d       # 用包里或仓库里的 docker-compose.lan.yml
```

镜像加载后带有 `ghcr.io/freecode100year/private-talk:1` 标签，`docker-compose.lan.yml` 会直接用它，不会去联网拉取。

## 带进内网前先核对

内网环境通常要求核实软件来源：

```sh
sha256sum -c SHA256SUMS.txt                       # 与 Releases 里的 SHA256SUMS.txt 对比
gh attestation verify private-talk-win-x64.zip -R Freecode100Year/private-talk   # 在能上网的电脑上核验构建来源
```

所有安装包都由 GitHub Actions 从本仓库源码构建（`.github/workflows/offline.yml`、`scripts/offline-packages.sh`），附有构建来源证明。

## 内网里需要注意

- **完全不联网**：页面不加载任何外部资源（字体、脚本、统计都没有），服务器也不连接外部。
- **防火墙**：放行端口 8443（或你设置的 `PORT`）。Windows 第一次启动会弹窗，选“专用网络”。
- **长期运行**：Windows 可用任务计划程序在开机时运行 `start-lan.cmd`；Linux 可参考 `deploy/private-talk.service`，把 `ExecStart` 改成包里的 `node/bin/node server/lan.mjs`，并设置 `WorkingDirectory` 为解压目录。
- **更新**：下载新版本的包，解压到新目录，把旧目录里的 `lan-certs` 文件夹复制过去（各设备已装的证书继续有效），再启动。
- **安卓手机**：Termux 需要联网安装一次，离线内网里不适用。
