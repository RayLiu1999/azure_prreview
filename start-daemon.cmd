@echo off
setlocal

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%daemon"
if errorlevel 1 (
  echo [prreview] 無法切換到 daemon 目錄：%PROJECT_DIR%daemon
  pause
  exit /b 1
)

if not defined PRREVIEW_CONFIG_DIR set "PRREVIEW_CONFIG_DIR=%USERPROFILE%\.prreview"

where npm >nul 2>&1
if errorlevel 1 (
  echo [prreview] 找不到 npm，請先安裝 Node.js 20 以上。
  pause
  exit /b 1
)

echo [prreview] 正在啟動 daemon...
echo [prreview] token 會讀取或建立於：%PRREVIEW_CONFIG_DIR%\token
echo [prreview] 要複製 token，請執行 scripts\copy-token.cmd
echo.
npm start
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo [prreview] daemon 已結束，退出代碼：%EXIT_CODE%
pause
exit /b %EXIT_CODE%
