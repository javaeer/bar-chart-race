@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  未检测到 Node.js。
  echo  不想安装？直接双击 dist\bar-chart-race-standalone.html 即可使用，无需任何环境。
  echo  要用开发模式请先安装 Node.js: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

start "" "http://localhost:5173"
node scripts\serve.js
