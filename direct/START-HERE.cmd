@echo off
setlocal
cd /d "%~dp0"
echo MiceHole V3 - First-time setup / repeat check
echo This runs workspace initialization and a local-only Doctor.
echo It does NOT enable remote high privilege or configure a tunnel.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-friend.ps1" %*
if errorlevel 1 goto failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\friend-doctor.ps1"
if errorlevel 1 goto failed
echo.
echo Local setup check completed. Remote ChatGPT access requires your own Tunnel and authorization.
echo See START-HERE.zh-CN.md for remaining steps.
pause
exit /b 0
:failed
echo.
echo Setup or Doctor returned an error. Review the output above.
echo See START-HERE.zh-CN.md and the repository install guide.
pause
exit /b 1
