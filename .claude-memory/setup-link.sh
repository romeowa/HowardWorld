#!/bin/bash
# Claude Code의 프로젝트 memory를 이 repo의 .claude-memory 로 연결한다.
# 새 PC에서 repo를 clone/pull 한 뒤 "한 번만" 실행하면,
# 이후 git pull 할 때마다 다른 PC에서 쓰던 memory가 이 PC의 Claude에도 반영된다.
#
#   bash .claude-memory/setup-link.sh
#
set -euo pipefail

# repo 루트 (이 스크립트의 상위 폴더)
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Claude Code는 프로젝트 경로의 / 를 - 로 바꿔 memory 폴더를 만든다
ENC="$(echo "$REPO_DIR" | sed 's#/#-#g')"
TARGET="$HOME/.claude/projects/$ENC/memory"
SRC="$REPO_DIR/.claude-memory"

mkdir -p "$(dirname "$TARGET")"

if [ -L "$TARGET" ]; then
  echo "이미 연결돼 있음: $TARGET -> $(readlink "$TARGET")"
  exit 0
fi

if [ -e "$TARGET" ]; then
  # 이 PC에 원래 있던 실제 memory는 지우지 않고 백업 (필요하면 수동 병합)
  BAK="$TARGET.bak.$(date +%s)"
  mv "$TARGET" "$BAK"
  echo "기존 memory 백업: $BAK"
  echo "  (필요하면 이 안의 내용을 $SRC 로 옮겨 병합하세요)"
fi

ln -s "$SRC" "$TARGET"
echo "연결 완료: $TARGET -> $SRC"
