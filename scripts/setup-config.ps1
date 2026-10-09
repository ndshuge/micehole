$ErrorActionPreference = "Stop"
$homeDir = Join-Path $env:LOCALAPPDATA 'MiceHole'
$cfgPath = Join-Path $homeDir 'config.json'
New-Item -ItemType Directory -Force -Path $homeDir | Out-Null
if(Test-Path -LiteralPath $cfgPath) {
  Write-Output "CONFIG_EXISTS=$cfgPath (preserved)"
  exit 0
}
$workspace = Join-Path $env:USERPROFILE 'MiceHoleWorkspace'
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
@{ workspace=$workspace; executionEnabled=$false } |
  ConvertTo-Json | Set-Content -LiteralPath $cfgPath -Encoding UTF8
Write-Output "CONFIG_CREATED=$cfgPath"
Write-Output "WORKSPACE=$workspace"
Write-Output "Shell execution DISABLED until you explicitly enable it."
