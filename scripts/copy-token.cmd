@echo off
setlocal

if not defined PRREVIEW_CONFIG_DIR set "PRREVIEW_CONFIG_DIR=%USERPROFILE%\.prreview"
set "PRREVIEW_TOKEN_FILE=%PRREVIEW_CONFIG_DIR%\token"

if not exist "%PRREVIEW_TOKEN_FILE%" (
  echo [prreview] 找不到 token：%PRREVIEW_TOKEN_FILE%
  echo [prreview] 請先執行 start-daemon.cmd，讓 daemon 建立 token。
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0copy-token.ps1" -TokenFile "%PRREVIEW_TOKEN_FILE%"
if errorlevel 1 (
  echo [prreview] token 複製失敗，請確認 PowerShell 與 token 檔案。
  pause
  exit /b 1
)

echo [prreview] token 已複製到剪貼簿，可直接貼到 PR 側邊欄設定。
pause
exit /b 0
