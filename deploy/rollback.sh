#!/usr/bin/env bash
# 把线上回滚到指定版本。回滚与发布走同一条流程，重新构建并做健康检查。
#
# 用法:
#   bash deploy/rollback.sh                 查看当前线上版本和可回滚的投运标签
#   bash deploy/rollback.sh v1.2.0-live     回滚（会要求确认）
#   bash deploy/rollback.sh v1.2.0-live --yes   不询问，直接回滚
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

REF=""; ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    -*) echo "未知参数: $arg" >&2; exit 2 ;;
    *) if [ -n "$REF" ]; then echo "只能指定一个版本" >&2; exit 2; fi; REF=$arg ;;
  esac
done

if [ -z "$REF" ]; then
  echo "当前线上: $(git log -1 --format='%h  %s  (%cs)' live)"
  echo
  echo "可回滚的投运标签（新到旧）:"
  git tag -l 'v*-live' --sort=-creatordate --format='  %(refname:short)  %(objectname:short)  %(*objectname:short)  %(contents:subject)'
  echo
  echo "回滚: bash deploy/rollback.sh <标签>"
  exit 0
fi

git rev-parse --verify --quiet "$REF^{commit}" >/dev/null || { echo "找不到版本: $REF" >&2; exit 2; }
echo "当前线上: $(git log -1 --format='%h  %s' live)"
echo "回滚到:   $REF（$(git log -1 --format='%h  %s' "$REF^{commit}")）"
if [ "$ASSUME_YES" != 1 ]; then
  read -r -p "确认回滚？输入 y 继续: " answer
  [ "$answer" = y ] || { echo "已取消"; exit 1; }
fi
exec bash deploy/publish.sh "$REF"
