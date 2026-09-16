@echo off
chcp 65001 >nul
setlocal

set "PROJECT_DIR=%~dp0"
set "TOKEN_SCRIPT=%PROJECT_DIR%scripts\copy-token.cmd"
if not exist "%TOKEN_SCRIPT%" (
  echo [prreview] 找不到 token 複製腳本：%TOKEN_SCRIPT%
  pause
  exit /b 1
)

cd /d "%PROJECT_DIR%"
if errorlevel 1 (
  echo [prreview] 無法切換到專案目錄：%PROJECT_DIR%
  pause
  exit /b 1
)

if not defined PRREVIEW_CONFIG_DIR set "PRREVIEW_CONFIG_DIR=%USERPROFILE%\.prreview"
for %%I in ("%PRREVIEW_CONFIG_DIR%") do set "PRREVIEW_CONFIG_DIR=%%~fI"
set "TOKEN_FILE=%PRREVIEW_CONFIG_DIR%\token"

where npm >nul 2>&1
if errorlevel 1 (
  echo [prreview] 找不到 npm，請先安裝 Node.js 20 以上。
  pause
  exit /b 1
)

echo [prreview] 正在開啟 daemon 視窗...
echo [prreview] token 會讀取或建立於：%TOKEN_FILE%
start "prreview daemon" /D "%PROJECT_DIR%daemon" "%ComSpec%" /d /k "npm start"
if errorlevel 1 (
  echo [prreview] 無法啟動 daemon 視窗。
  pause
  exit /b 1
)

echo [prreview] 等待 daemon 建立 token...
for /l %%N in (1,1,20) do (
  if exist "%TOKEN_FILE%" goto token_ready
  >nul timeout /t 1 /nobreak
)

echo [prreview] 等待 token 逾時，請查看 daemon 視窗的錯誤訊息。
pause
exit /b 1

:token_ready
call "%TOKEN_SCRIPT%" /nopause
set "COPY_EXIT=%ERRORLEVEL%"
if not "%COPY_EXIT%"=="0" (
  echo [prreview] token 自動複製失敗，請手動執行 "%TOKEN_SCRIPT%"。
  pause
  exit /b %COPY_EXIT%
)

echo [prreview] daemon 已啟動，token 已自動複製到剪貼簿。
exit /b 0
