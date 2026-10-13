#!/bin/sh
# 隐匿对话 离线更新：./update.sh <新版本安装包>   ./update.sh --rollback   ./update.sh --import <旧文件夹>
cd "$(dirname "$0")" || exit 1
if [ -x node/bin/node ]; then NODE=./node/bin/node; else NODE=node; fi
exec "$NODE" app/server/update.mjs "$@"
