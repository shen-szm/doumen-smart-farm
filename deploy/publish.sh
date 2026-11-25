#!/usr/bin/env bash
# 把指定版本发布到线上。回滚就是用旧标签再发布一次（见 deploy/rollback.sh）。
#
# 用法:
#   bash deploy/publish.sh <标签或提交> [--no-restart] [--plan]
#     --plan        只打包并列出将执行的操作，不连接服务器
#     --no-restart  不重启站点进程（仅当 server/ 与构建配置都没变时使用）
#
# 流程: 按提交打包 → 上传到服务器电脑 → 暂存目录构建 → 成功后切换 →
#       重启站点进程 → 健康检查（核对线上产物与构建结果一致）→ 移动 live 指针
# 任何一步失败都不会移动 live 指针，并给出回滚命令。
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
. "$(dirname "$0")/env.sh"

REF=""; RESTART=1; PLAN=0
for arg in "$@"; do
  case "$arg" in
    --plan) PLAN=1 ;;
    --no-restart) RESTART=0 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    -*) echo "未知参数: $arg" >&2; exit 2 ;;
    *) if [ -n "$REF" ]; then echo "只能指定一个版本" >&2; exit 2; fi; REF=$arg ;;
  esac
done
[ -n "$REF" ] || { echo "用法: bash deploy/publish.sh <标签或提交> [--plan] [--no-restart]" >&2; exit 2; }

COMMIT=$(git rev-parse --verify --quiet "$REF^{commit}") || { echo "找不到版本: $REF" >&2; exit 2; }
TAG=$(git describe --exact-match --tags "$COMMIT" 2>/dev/null || true)
NAME=$(printf '%s' "${TAG:-$(git rev-parse --short "$COMMIT")}" | tr '/ ' '__')
PREVIOUS=$(git rev-parse --short live 2>/dev/null || echo 无)
LOG=$(git rev-parse --git-dir)/doumen-releases.log
log() { printf '%s\t%s\t%s -> %s\n' "$(date '+%F %T')" "$1" "$PREVIOUS" "$NAME" >> "$LOG"; }
# 任何一步意外出错都记入发布日志（已自行记录的失败分支不走这里）。
trap 'status=$?; [ "$PLAN" = 1 ] || log "失败：脚本在第 $LINENO 行中止（见上方输出）"; exit $status' ERR
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# ---- 打包前的自检：缺目录或媒体文件不全就中止，避免把空白地图发上线 ----
PATHS=(src server public index.html vite.config.mjs package.json package-lock.json)
for p in "${PATHS[@]}"; do
  git cat-file -e "$COMMIT:$p" 2>/dev/null || { echo "版本 $NAME 缺少 $p，已中止" >&2; exit 2; }
done
MEDIA=$(git ls-tree -r --name-only "$COMMIT" public/media | wc -l)
[ "$MEDIA" -ge 20 ] || { echo "版本 $NAME 的 public/media 只有 $MEDIA 个文件，地图会空白，已中止" >&2; exit 2; }

ZIP="$WORK/$NAME.zip"
git archive --format=zip -o "$ZIP" "$COMMIT" "${PATHS[@]}"
command -v unzip >/dev/null && unzip -tq "$ZIP" >/dev/null

echo "发布版本: $NAME（${COMMIT:0:7}）"
echo "当前线上: $PREVIOUS"
echo "发布包: $(du -h "$ZIP" | cut -f1)，媒体文件 $MEDIA 个"
if [ "$PLAN" = 1 ]; then
  echo "[计划] 上传 → 暂存目录构建并切换 → $([ "$RESTART" = 1 ] && echo '重启站点进程' || echo '不重启') → 健康检查 → live 指针移到 $NAME"
  exit 0
fi

# ---- 1. 管理通道预检（任何一层主机密钥不符都会在这里停下）----
if ! doumen_prepare 2>"$WORK/err" || ! doumen_win "echo CONNECTED" >/dev/null 2>>"$WORK/err"; then
  tail -n 6 "$WORK/err" >&2 | cut -c1-200
  cat >&2 <<'EOF'
连不上服务器电脑的管理通道，或某一层主机密钥校验未通过。本脚本不会自动信任新密钥。
若提示 Permission denied，多半是 Windows 的 ssh-agent 里没有已解锁的 ~/.ssh/id_ed25519，
在 PowerShell 里执行 ssh-add ~/.ssh/id_ed25519 后重试。访问方式有变则修改 deploy/env.sh。
EOF
  log "失败：管理通道不可用"; exit 1
fi

# ---- 2. 上传发布包与服务器端脚本，并在服务器留档 ----
echo "① 上传发布包"
doumen_wsl "mkdir -p $DOUMEN_WSL_DIR/incoming $DOUMEN_WSL_DIR/releases"
doumen_scp "$ZIP" "$DOUMEN_WSL_DIR/incoming/$NAME.zip"
doumen_scp deploy/apply-release.bat deploy/restart-server.bat "$DOUMEN_WSL_DIR/incoming/"
doumen_win "copy /y $DOUMEN_SERVER_DIR\incoming\\$NAME.zip $DOUMEN_SERVER_DIR\releases\\ >nul"

# ---- 3. 暂存目录构建，成功后切换线上产物 ----
echo "② 构建并切换"
if ! doumen_win "$DOUMEN_SERVER_DIR\\incoming\\apply-release.bat $NAME" | tr -d '\r'; then
  cat >&2 <<EOF
同步或构建失败，线上产物未变。查看上方输出；依赖变更需先在服务器执行 npm ci。
回滚到当前线上版本: bash deploy/rollback.sh $PREVIOUS
EOF
  log "失败：同步或构建出错"; exit 1
fi
# 入口文件名取自 index.html 实际引用的那一个：切换时保留了上一版的资源，assets 里会有多个 index-*.js
BUNDLE=$(doumen_win "type $DOUMEN_SERVER_DIR\\dist\\client\\index.html" | tr -d '\r' | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1 | sed 's#^assets/##')
[ -n "$BUNDLE" ] || { echo "服务器上找不到构建产物，线上可能异常。回滚: bash deploy/rollback.sh $PREVIOUS" >&2; log "失败：找不到构建产物"; exit 1; }

# ---- 4. 重启（server/*.mjs 与中间件在进程启动时加载）----
if [ "$RESTART" = 1 ]; then
  echo "③ 重启站点进程"
  doumen_win "$DOUMEN_SERVER_DIR\\incoming\\restart-server.bat" | tr -d '\r'
fi

# ---- 5. 健康检查：经 ECS 核对线上实际提供的产物 ----
echo "④ 健康检查"
ecs() { ssh -i "$DOUMEN_ECS_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 "root@$DOUMEN_ECS_HOST" "$@"; }
HEALTH=$(ecs 'bash -s' <<EOF | tr -d '\r'
BUNDLE='$BUNDLE'
for i in \$(seq 1 40); do
  code=\$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1/\$BUNDLE")
  [ "\$code" = 200 ] && break
  sleep 2
done
echo "bundle_http=\$code"
echo "served=\$(curl -s -m 10 http://127.0.0.1/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)"
echo "crops_http=\$(curl -s -m 120 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/crops)"
EOF
)
echo "$HEALTH" | sed 's/^/   /'
SERVED=$(grep '^served=' <<<"$HEALTH" | cut -d= -f2)
BUNDLE_HTTP=$(grep '^bundle_http=' <<<"$HEALTH" | cut -d= -f2)
CROPS_HTTP=$(grep '^crops_http=' <<<"$HEALTH" | cut -d= -f2)
# 站点与产物必须正常；/api/crops 只作提示——回滚到没有该接口的旧版本时不应判为失败
if [ "$SERVED" != "assets/$BUNDLE" ] || [ "$BUNDLE_HTTP" != 200 ]; then
  cat >&2 <<EOF
健康检查未通过：线上提供的产物与构建结果不一致或站点不可访问。
回滚: bash deploy/rollback.sh $PREVIOUS
EOF
  log "失败：健康检查未通过"; exit 1
fi
[ "$CROPS_HTTP" = 200 ] || echo "提示：/api/crops 返回 $CROPS_HTTP（回滚到较早版本时属正常，该版本没有此接口）"

# ---- 6. 只有全部通过才移动 live 指针 ----
git branch -f live "$COMMIT"
log "成功"
echo
echo "发布完成: $PREVIOUS → $NAME（$BUNDLE）"
echo "回滚上一版: bash deploy/rollback.sh $PREVIOUS"
