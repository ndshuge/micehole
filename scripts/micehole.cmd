@echo off
setlocal
rem Never propagate tunnel runtime secrets into the untrusted coding tool process.
set "CONTROL_PLANE_API_KEY="
set "MOUSE_HOLE_CONTROL_PLANE_API_KEY="
set "OPENAI_API_KEY="
set "PATH=%~dp0runtime;%PATH%"
"%~dp0runtime\node.exe" "%~dp0src\server.mjs" %*
