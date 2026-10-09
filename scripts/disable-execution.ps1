$ErrorActionPreference = "Stop"
$cfgPath=Join-Path $env:LOCALAPPDATA 'MiceHole\config.json'
if(!(Test-Path -LiteralPath $cfgPath)){throw 'Configuration not found.'}
$cfg=Get-Content -Raw -LiteralPath $cfgPath | ConvertFrom-Json
$cfg.executionEnabled=$false
$cfg | ConvertTo-Json | Set-Content -LiteralPath $cfgPath -Encoding UTF8
Write-Host 'Execution disabled.'
