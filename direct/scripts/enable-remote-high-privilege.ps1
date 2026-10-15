[CmdletBinding()]
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
