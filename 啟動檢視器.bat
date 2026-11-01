@echo off
chcp 65001 >nul
cd /d "%~dp0"

:: 1. 若已經有 node_modules 裡的 electron.exe (例如開發者本地或完整包)，直接秒開
if exist "%~dp0node_modules\electron\dist\electron.exe" (
    start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
    exit
)

:: 2. 若已經自動下載過獨立版 runtime，直接秒開
if exist "%~dp0runtime\electron.exe" (
    start "" "%~dp0runtime\electron.exe" "%~dp0."
    exit
)

:: 3. 首次啟動且無核心時：免安裝 Node.js，直接用 Windows 內建工具下載 Electron 核心
echo ========================================================
echo   首次啟動【勝利女神：妮姬 L2D 檢視器】
echo   正在自動下載運行環境 (免安裝 Node.js，約需 1 分鐘)...
echo ========================================================
echo.

mkdir "%~dp0runtime" 2>nul
curl -L "https://github.com/electron/electron/releases/download/v33.2.0/electron-v33.2.0-win32-x64.zip" -o "%~dp0runtime\electron.zip"

if not exist "%~dp0runtime\electron.zip" (
    echo ❌ 下載失敗，請檢查網路連線！
    pause
    exit /b 1
)

echo.
echo 📦 正在解壓縮運行環境...
tar -xf "%~dp0runtime\electron.zip" -C "%~dp0runtime"
del /f /q "%~dp0runtime\electron.zip"

echo ✅ 環境配置完成！正在啟動檢視器...
start "" "%~dp0runtime\electron.exe" "%~dp0."
exit