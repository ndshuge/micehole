param([string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'))
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$src=Join-Path $repo 'direct'
if(-not(Test-Path (Join-Path $src 'micehole-direct.cmd'))) {throw 'Missing direct-port launcher'}
node (Join-Path $repo 'scripts\test-direct-port.mjs')
if($LASTEXITCODE -ne 0) {throw 'Portable MCP acceptance tests failed'}
New-Item -ItemType Directory -Force $OutputDirectory|Out-Null
$zip=Join-Path $OutputDirectory 'MiceHole-Direct-vNext-0.2.1-RC-Portable.zip'
if(Test-Path $zip){Remove-Item $zip -Force}
Compress-Archive -Path (Join-Path $src '*') -DestinationPath $zip -CompressionLevel Optimal
$hash=(Get-FileHash $zip -Algorithm SHA256).Hash
Set-Content -Path (Join-Path $OutputDirectory 'MiceHole-Direct-vNext-0.2.1-RC-SHA256SUMS.txt') -Value "$hash  MiceHole-Direct-vNext-0.2.1-RC-Portable.zip" -Encoding ASCII
Write-Output "PACKAGE=$zip"
Write-Output "SHA256=$hash"
Write-Output 'STATUS=LOCAL_STDIO_TESTED_REMOTE_HIGH_PRIVILEGE_UNVERIFIED'
