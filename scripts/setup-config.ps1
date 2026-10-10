$ErrorActionPreference = "Stop"
# CI/QA-only isolated install: redirect *all* bootstrap files without touching
# the actual user's MiceHole settings. Normal installers never set this variable.
$qaRoot = $env:MICEHOLE_INSTALL_TEST_ROOT
if($qaRoot){
  if(-not [IO.Path]::IsPathRooted($qaRoot)){throw 'MICEHOLE_INSTALL_TEST_ROOT must be absolute'}
  $homeDir = Join-Path $qaRoot 'LocalAppData\MiceHole'
}else{
  $homeDir = Join-Path $env:LOCALAPPDATA 'MiceHole'
}
$cfgPath = Join-Path $homeDir 'config.json'
New-Item -ItemType Directory -Force -Path $homeDir | Out-Null
if(Test-Path -LiteralPath $cfgPath) {
  Write-Output "CONFIG_EXISTS=$cfgPath (preserved)"
  exit 0
}
$workspace = if($qaRoot){Join-Path $qaRoot 'Workspace'}else{Join-Path $env:USERPROFILE 'MiceHoleWorkspace'}
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
@{ workspace=$workspace; executionEnabled=$false } |
  ConvertTo-Json | Set-Content -LiteralPath $cfgPath -Encoding UTF8
Write-Output "CONFIG_CREATED=$cfgPath"
Write-Output "WORKSPACE=$workspace"
Write-Output "Shell execution DISABLED until you explicitly enable it."
