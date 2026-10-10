[CmdletBinding()]
param([string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'MiceHole\remote'))
$ErrorActionPreference = 'Stop'
$keyFile = Join-Path $StateRoot 'runtime-key.dpapi'
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$secure = Read-Host 'Enter the OpenAI Tunnel RUNTIME API key (input hidden, not an admin key)' -AsSecureString
if($null -eq $secure -or $secure.Length -eq 0) { throw 'Empty runtime API key' }
try { $secure | ConvertFrom-SecureString | Set-Content -LiteralPath $keyFile -Encoding ASCII }
finally { $secure.Dispose() }
Write-Output 'MICEHOLE_REMOTE_KEY_SAVED=PASS'
Write-Output 'Credential encrypted for this Windows user with DPAPI. Do not move the encrypted file to another user.'
