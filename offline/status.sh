#!/bin/sh
# 隐匿对话：版本、设置、证书和运行状态。
cd "$(dirname "$0")" || exit 1
if [ -x node/bin/node ]; then NODE=./node/bin/node; else NODE=node; fi
exec "$NODE" app/server/status.mjs
