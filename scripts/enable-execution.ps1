$ErrorActionPreference = "Stop"
$cfgPath=Join-Path $env:LOCALAPPDATA 'MiceHole\config.json'
if(!(Test-Path -LiteralPath $cfgPath)){throw 'Install and initialize MiceHole first.'}
Write-Host 'WARNING: Enables commands and programs with your Windows user permissions.'
Write-Host 'Workspace file restrictions do NOT sandbox commands or npm scripts.'
Write-Host 'Use trusted projects only; never expose an unauthenticated remote endpoint.'
$answer=Read-Host "Type ENABLE to proceed"
if($answer -cne 'ENABLE'){Write-Host 'No change.';exit 1}
$cfg=Get-Content -Raw -LiteralPath $cfgPath | ConvertFrom-Json
$cfg.executionEnabled=$true
$cfg | ConvertTo-Json | Set-Content -LiteralPath $cfgPath -Encoding UTF8
Write-Host 'Execution enabled.'
