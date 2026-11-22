@echo off
rem ============================================================
rem  Doumen smart-farm local server launcher
rem  Runs from: <project>\deploy\start-server.bat
rem  Ensures node_modules + dist exist, then serves on 127.0.0.1:4173
rem  (API middleware for /api/* is attached by vite.config.mjs)
rem ============================================================
setlocal
cd /d "%~dp0.."

rem use portable Node if present (installed by assistant)
if exist "C:\doumen\node\node.exe" set "PATH=C:\doumen\node;%PATH%"

if not exist node_modules (
  echo [start-server] installing dependencies...
  call npm install --registry=https://registry.npmmirror.com || goto :fail
)

if not exist dist\client\index.html (
  echo [start-server] building production bundle...
  call npm run build || goto :fail
)

echo [start-server] starting on http://127.0.0.1:4173
npx vite preview --host 127.0.0.1 --port 4173 --strictPort
exit /b %errorlevel%

:fail
echo [start-server] FAILED - see log above.
pause
exit /b 1
