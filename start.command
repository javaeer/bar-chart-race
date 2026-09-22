#!/usr/bin/env bash
# 免命令行启动：双击（macOS 会以 Terminal 运行 .command）
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  未检测到 Node.js。"
  echo "  不想安装？直接双击 dist/bar-chart-race-standalone.html 即可使用，无需任何环境。"
  echo "  要用开发模式请先安装 Node.js: https://nodejs.org/"
  echo ""
  read -r -p "按回车键关闭…" _
  exit 1
fi

# 后台打开浏览器（失败不阻断服务器）
( sleep 1
  open "http://localhost:5174" 2>/dev/null \
    || xdg-open "http://localhost:5174" 2>/dev/null \
    || true ) &

node scripts/serve.js
