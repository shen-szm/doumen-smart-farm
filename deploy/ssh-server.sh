#!/usr/bin/env bash
# 经阿里云跳板在服务器电脑（Windows）上执行一条命令。
# 用法: deploy/ssh-server.sh "dir C:\doumen\src"
# 主机密钥严格校验：对不上就拒绝连接，不会自动信任新密钥。
set -euo pipefail
. "$(dirname "$0")/env.sh"
exec ssh -i "$DOUMEN_MGMT_KEY" -p "$DOUMEN_MGMT_PORT" "${DOUMEN_SSH_OPTS[@]}" "$DOUMEN_MGMT_USER@127.0.0.1" "$@"
