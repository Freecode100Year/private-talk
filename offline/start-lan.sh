#!/bin/sh
# 隐匿对话：局域网 / 内网模式。按 Ctrl+C 停止。
cd "$(dirname "$0")" || exit 1
exec ./node/bin/node server/lan.mjs
