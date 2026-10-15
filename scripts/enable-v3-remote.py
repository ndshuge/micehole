from pathlib import Path
import shutil
r=Path(r"E:\CHATGPT\downloads\micehole-v3-release-work")
d=r/"direct"
s=d/"scripts"
for name in ("remote-setup.ps1","remote-save-key.ps1","remote-doctor.ps1","remote-run.ps1"):
    v=(r/"scripts"/name).read_text(encoding="utf-8-sig")
    v=v.replace("MiceHole\\remote", "MiceHoleV3\\remote")
    if name=="remote-setup.ps1":
        v=v.replace("$runner = Join-Path $InstallRoot 'micehole-remote.cmd'", "$runner = Join-Path $InstallRoot 'micehole-remote.cmd'")
    (s/name).write_text(v,encoding="utf-8")
(d/"micehole-remote.cmd").write_text("""@echo off
setlocal
if not exist "%LOCALAPPDATA%\\MiceHoleV3\\remote-high-privilege.enabled" (echo High-privilege remote access not approved on this Windows account. Run scripts\\enable-remote-high-privilege.ps1 1>&2 & exit /b 5)
set "CONTROL_PLANE_API_KEY="
set "MOUSE_HOLE_CONTROL_PLANE_API_KEY="
set "OPENAI_API_KEY="
set "MICEHOLE_REMOTE_SESSION=1"
call "%~dp0micehole-direct.cmd" %*
""",encoding="utf-8")
(s/"enable-remote-high-privilege.ps1").write_text("""[CmdletBinding()]
param([switch]$Disable)
$ErrorActionPreference='Stop'
$dir=Join-Path $env:LOCALAPPDATA 'MiceHoleV3'
$marker=Join-Path $dir 'remote-high-privilege.enabled'
if($Disable){
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  Write-Output 'REMOTE_HIGH_PRIVILEGE=DISABLED'
  exit 0
}
Write-Host 'WARNING: Remote ChatGPT tools can run arbitrary Windows commands, control GUI and browsers as your logged-in user.'
Write-Host 'Workspace path restrictions do NOT sandbox shell commands. Same-user execution may access your Tunnel DPAPI credentials.'
Write-Host 'Use only YOUR OWN authenticated private Tunnel and do not run the service elevated.'
$answer=Read-Host 'To enable, type exactly: ENABLE HIGH PRIVILEGE'
if($answer -cne 'ENABLE HIGH PRIVILEGE'){throw 'Consent not granted; no change made'}
New-Item -ItemType Directory -Force $dir|Out-Null
Set-Content -LiteralPath $marker -Value 'consent-v1' -Encoding ASCII
Write-Output 'REMOTE_HIGH_PRIVILEGE=ENABLED'
""",encoding="utf-8")
print("Created high-privilege remote launcher, local consent and Tunnel scripts")
