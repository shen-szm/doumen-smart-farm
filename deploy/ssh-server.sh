#!/usr/bin/env bash
# 在服务器电脑的 Windows 侧（doumen_deploy，cmd.exe）执行一条命令。
# 路径：本机 → 公网 2222 → 服务器电脑的 WSL → Windows。私钥不落服务器，靠 agent 转发。
# 用法: deploy/ssh-server.sh "dir C:\doumen\src"     （命令里不要带双引号）
# 每一层都严格校验主机密钥：对不上就拒绝连接，不会自动信任新密钥。
set -euo pipefail
. "$(dirname "$0")/env.sh"
doumen_prepare
doumen_win "$@"
