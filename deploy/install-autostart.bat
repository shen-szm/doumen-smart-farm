@echo off
rem ============================================================
rem  Registers + starts two scheduled tasks (at logon):
rem    doumen-server : deploy\start-server.bat  (local site :4173)
rem    doumen-tunnel : deploy\tunnel-hidden.vbs (SSH reverse tunnel)
rem  Run this file ONCE as administrator on the home-server PC.
rem ============================================================
setlocal
set PROJECT=%~dp0..

schtasks /create /f /tn doumen-server /tr "\"%PROJECT%deploy\start-server.bat\"" /sc onlogon /rl limited
schtasks /create /f /tn doumen-tunnel /tr "wscript.exe \"%PROJECT%deploy\tunnel-hidden.vbs\"" /sc onlogon /rl limited

schtasks /run /tn doumen-server
schtasks /run /tn doumen-tunnel

echo.
echo Installed and started. Verify:
echo   http://127.0.0.1:4173          (local, on this PC)
echo   tasklist ^| findstr /i "ssh node"
pause
