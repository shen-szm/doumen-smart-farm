# 发布脚本的连接参数，被 publish.sh / rollback.sh / ssh-server.sh / scp-server.sh 共用。
# 访问方式变更时只改这里；也可用同名环境变量临时覆盖。
export DOUMEN_ECS_HOST="${DOUMEN_ECS_HOST:-8.138.151.152}"
export DOUMEN_ECS_KEY="${DOUMEN_ECS_KEY:-$HOME/.ssh/aliyun-doumen.pem}"

# 服务器电脑的管理通道（2026-11-23 起）：
#   本机 → 公网 2222 → 服务器电脑上的 WSL（wsluser）→ 再跳进 Windows（doumen_deploy，cmd.exe）
# 2222、2221 两个端口由用户维护，发布脚本只使用、不改动。
export DOUMEN_WSL_HOST="${DOUMEN_WSL_HOST:-wsl}"   # ~/.ssh/config 里的别名：8.138.151.152:2222，用户 wsluser
export DOUMEN_MGMT_USER="${DOUMEN_MGMT_USER:-doumen_deploy}"
export DOUMEN_MGMT_KEY="${DOUMEN_MGMT_KEY:-$HOME/.ssh/doumen-mgmt}"
export DOUMEN_SERVER_DIR="C:\\doumen"                # Windows 侧的项目目录
export DOUMEN_WSL_DIR="/mnt/c/doumen"               # 同一目录在 WSL 里的路径

# 用 Windows 自带的 ssh / scp：它们能用系统级 ssh-agent 里已解锁的密钥，并支持把 agent 转发进 WSL。
WIN_OPENSSH=/c/Windows/System32/OpenSSH
DOUMEN_SSH="$WIN_OPENSSH/ssh.exe"
DOUMEN_SCP="$WIN_OPENSSH/scp.exe"
DOUMEN_SSH_ADD="$WIN_OPENSSH/ssh-add.exe"
# Windows sshd 的主机公钥（固定校验；用别名而不是 IP，WSL 重启后宿主地址变了也不受影响）。
DOUMEN_WIN_HOSTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/win-hosts"

# StrictHostKeyChecking=yes：任何一层主机密钥对不上都拒绝连接，不自动信任新密钥。
DOUMEN_WSL_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=25)

# 进入管理通道前的准备：管理密钥须在 Windows 的 ssh-agent 里（私钥不落服务器，靠 agent 转发），
# 并把 Windows 主机公钥放到 WSL 的临时目录。
doumen_prepare() {
  "$DOUMEN_SSH_ADD" -l >/dev/null 2>&1 || { echo "Windows 的 ssh-agent 不可用（服务 ssh-agent 未运行？）" >&2; return 1; }
  "$DOUMEN_SSH_ADD" -l 2>/dev/null | grep -q doumen-mgmt \
    || "$DOUMEN_SSH_ADD" "$(cygpath -w "$DOUMEN_MGMT_KEY")" >/dev/null 2>&1
  MSYS_NO_PATHCONV=1 "$DOUMEN_SSH" "${DOUMEN_WSL_OPTS[@]}" "$DOUMEN_WSL_HOST" "cat > /tmp/doumen-win-hosts" < "$DOUMEN_WIN_HOSTS"
}

# 在服务器电脑的 WSL 里执行一条命令。-A 表示把本机 agent 转发进去（跳进 Windows 时需要）。
doumen_wsl() {
  local forward=""
  [ "${1:-}" = "-A" ] && { forward="-A"; shift; }
  MSYS_NO_PATHCONV=1 "$DOUMEN_SSH" $forward "${DOUMEN_WSL_OPTS[@]}" "$DOUMEN_WSL_HOST" "$1" < /dev/null
}

# 在服务器电脑的 Windows 侧（doumen_deploy，cmd.exe）执行一条命令。命令里不要带双引号。
doumen_win() {
  local inner="ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o HostKeyAlias=windows-doumen \
-o UserKnownHostsFile=/tmp/doumen-win-hosts -o ConnectTimeout=15 \
$DOUMEN_MGMT_USER@\$(ip route 2>/dev/null | awk '/^default/{print \$3; exit}')"
  doumen_wsl -A "$inner $(printf '%q' "$1")"
}

# 上传本机文件到服务器电脑。目标用 WSL 路径，如 /mnt/c/doumen/incoming/
doumen_scp() {
  local dest=${!#}
  local files=("${@:1:$#-1}") native=()
  for file in "${files[@]}"; do native+=("$(cygpath -w "$file")"); done
  MSYS_NO_PATHCONV=1 "$DOUMEN_SCP" "${DOUMEN_WSL_OPTS[@]}" "${native[@]}" "$DOUMEN_WSL_HOST:$dest"
}
