@echo off
setlocal
"%~dp0..\runtime\node.exe" "%~dp0..\src\server.mjs" --doctor
if errorlevel 1 (pause & exit /b 1)
pause
