@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo  Demo2APK 本地启动（Windows）
echo ============================================
echo.

where node >nul 2>&1 || (echo [x] 找不到 node，请确认已安装并加入 PATH & pause & exit /b 1)
where pnpm >nul 2>&1 || (echo [x] 找不到 pnpm，请先 npm i -g pnpm & pause & exit /b 1)

echo [1/4] 检查 Redis (127.0.0.1:6379) ...
netstat -an | findstr ":6379" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [warn] 6379 没在监听。worker 连不上 Redis 会一直重试。
  echo        请先启动本机 Redis / Memurai，或执行:
  echo        docker run -d -p 6379:6379 redis:alpine
  echo.
) else (
  echo       Redis 正常。
)

echo [2/4] 编译 core + backend（worker 跑的是 dist，必须编译）...
call pnpm --filter @demo2apk/core build
if errorlevel 1 goto :buildfail
call pnpm --filter @demo2apk/backend build
if errorlevel 1 goto :buildfail
echo       编译完成。
echo.

echo [3/4] 启动 API / Worker / Web ...
start "demo2apk API (3000)"    cmd /k "cd /d %~dp0 && pnpm dev"
timeout /t 2 >nul
start "demo2apk Worker"        cmd /k "cd /d %~dp0 && pnpm worker"
timeout /t 1 >nul
start "demo2apk Web (5173)"    cmd /k "cd /d %~dp0 && pnpm frontend"

echo [4/4] 等 Web 起来后打开 http://127.0.0.1:5173
timeout /t 6 >nul
start "" http://127.0.0.1:5173

echo.
echo 三个窗口都别关：API 收上传、Worker 真正打包、Web 是界面。
echo 打包日志在 Worker 窗口里；APK 默认落在 builds\ 下。
echo.
pause
exit /b 0

:buildfail
echo.
echo [x] 编译失败，把上面的 TS 报错贴给我。
pause
exit /b 1
