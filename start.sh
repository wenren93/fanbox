#!/usr/bin/env bash

set -Eeuo pipefail

# 始终从项目根目录启动，支持在任意目录调用此脚本。
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# 如果这个项目的开发版已经在运行，直接把现有应用切到前台。
# 同时核对监听进程的工作目录，避免误激活占用同一端口的其他程序。
find_running_pid() {
  local port="${FANBOX_PORT:-4567}"
  local pid process_dir

  command -v lsof >/dev/null 2>&1 || return 1
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    process_dir="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    if [[ "$process_dir" == "$PROJECT_DIR" ]]; then
      printf '%s\n' "$pid"
      return 0
    fi
  done < <(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null)

  return 1
}

# 监听端口的可能是 Electron 辅助进程，System Events 无法激活它们；
# 沿父进程链向上找到 .app bundle 的主可执行进程（GUI 主进程）。
find_app_pid() {
  local pid="$1" parent executable
  while [[ "$pid" =~ ^[0-9]+$ && "$pid" != "1" ]]; do
    executable="$(ps -o args= -p "$pid" 2>/dev/null || true)"
    executable="${executable%% *}"
    if [[ "$executable" == *.app/Contents/MacOS/* && "$executable" != */Frameworks/* ]]; then
      printf '%s\n' "$pid"
      return 0
    fi
    parent="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
    pid="$parent"
  done
  return 1
}

if RUNNING_PID="$(find_running_pid)"; then
  echo "FanBox 已在运行，正在打开应用窗口……"
  APP_PID="$(find_app_pid "$RUNNING_PID" || true)"
  kill -CONT "${APP_PID:-$RUNNING_PID}"
  if [[ "$(uname -s)" == "Darwin" ]] && command -v osascript >/dev/null 2>&1 && [[ -n "$APP_PID" ]]; then
    osascript -e "tell application \"System Events\" to set frontmost of first process whose unix id is $APP_PID to true"
  fi
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 Node.js，请先安装 Node.js 18 或更高版本。" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 18 )); then
  echo "错误：当前 Node.js 版本为 $(node --version)，本项目要求 18 或更高版本。" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "错误：未找到 npm，请重新安装包含 npm 的 Node.js。" >&2
  exit 1
fi

# 首次运行或 Electron 依赖不完整时自动安装依赖。
if [[ ! -x node_modules/.bin/electron ]]; then
  echo "正在安装项目依赖……"
  npm install
fi

echo "正在启动 FanBox……"
exec npm run app
