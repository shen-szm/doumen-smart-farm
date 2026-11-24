@echo off
rem ============================================================
rem  Runs on the server PC. Restarts the site process so changed
rem  server/*.mjs modules are loaded.
rem  schtasks /end alone does NOT stop vite preview: the launcher
rem  script exits and node keeps running as an orphan on :4173,
rem  so the listening PID is killed explicitly first.
rem ============================================================
setlocal
cd /d C:\doumen || exit /b 2
schtasks /end /tn doumen-server >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :4173 ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1
ping -n 3 127.0.0.1 >nul
schtasks /run /tn doumen-server
if errorlevel 1 ( echo [restart-server] failed to start task doumen-server & exit /b 3 )
echo [restart-server] OK
endlocal
exit /b 0
