@echo off
setlocal
if not defined MOUSE_HOLE_WORKSPACE set "MOUSE_HOLE_WORKSPACE=%USERPROFILE%\MiceHoleWorkspace"
if not exist "%MOUSE_HOLE_WORKSPACE%" mkdir "%MOUSE_HOLE_WORKSPACE%"
where node >nul 2>nul
if errorlevel 1 (echo Please install Node.js LTS. 1>&2 & exit /b 1)
node "%~dp0mcp\remote\mouse-hole-server.mjs"
