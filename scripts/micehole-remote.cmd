@echo off
setlocal
rem The PERSONAL TUNNEL entry point uses a restricted remote mode.
rem Shell/build/validation/Git process execution remains local-only pending credential isolation.
set "MICEHOLE_REMOTE_SESSION=1"
call "%~dp0micehole.cmd" %*
