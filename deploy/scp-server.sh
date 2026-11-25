#!/usr/bin/env bash
# 向服务器电脑上传文件。
# 用法: deploy/scp-server.sh <本机文件...> <目标路径，WSL 路径，如 /mnt/c/doumen/incoming/>
set -euo pipefail
. "$(dirname "$0")/env.sh"
[ $# -ge 2 ] || { echo "用法: deploy/scp-server.sh <本机文件...> <目标路径>" >&2; exit 2; }
doumen_prepare
doumen_scp "$@"
