@echo off
setlocal
if not exist "%LOCALAPPDATA%\MiceHoleV3\remote-high-privilege.enabled" (echo High-privilege remote access not approved on this Windows account. Run scripts\enable-remote-high-privilege.ps1 1>&2 & exit /b 5)
set "CONTROL_PLANE_API_KEY="
set "MOUSE_HOLE_CONTROL_PLANE_API_KEY="
set "OPENAI_API_KEY="
set "MICEHOLE_REMOTE_SESSION=1"
call "%~dp0micehole-direct.cmd" %*
