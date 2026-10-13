#!/bin/sh
# 隐匿对话：局域网 / 内网模式。按 Ctrl+C 停止。设置写在 config.env 里（见 config.env.example）。
cd "$(dirname "$0")" || exit 1
if [ -x node/bin/node ]; then NODE=./node/bin/node; else NODE=node; fi
exec "$NODE" app/server/lan.mjs
