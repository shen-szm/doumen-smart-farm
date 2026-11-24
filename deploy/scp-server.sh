#!/usr/bin/env bash
# 向服务器电脑上传文件。
# 用法: deploy/scp-server.sh <本机文件...> <目标路径，如 C:/doumen/incoming/>
set -euo pipefail
. "$(dirname "$0")/env.sh"
[ $# -ge 2 ] || { echo "用法: deploy/scp-server.sh <本机文件...> <目标路径>" >&2; exit 2; }
files=()
while [ $# -gt 1 ]; do files+=("$1"); shift; done
MSYS_NO_PATHCONV=1 scp -i "$DOUMEN_MGMT_KEY" -P "$DOUMEN_MGMT_PORT" "${DOUMEN_SSH_OPTS[@]}" "${files[@]}" "$DOUMEN_MGMT_USER@127.0.0.1:$1"
