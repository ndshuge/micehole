[CmdletBinding()]
param([string]$InstallRoot='')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=Split-Path -Parent $PSScriptRoot
if(-not $InstallRoot){$InstallRoot=Join-Path $repo 'dist\stage'}
$installed=(Resolve-Path -LiteralPath $InstallRoot).ProviderPath
$temp=Join-Path ([IO.Path]::GetTempPath()) ('MiceHole-Tunnel-Init-'+[Guid]::NewGuid().ToString('N'))
$mock='tunnel_0123456789abcdef0123456789abcdef'
try{
  & (Join-Path $PSScriptRoot 'remote-setup.ps1') -TunnelId $mock -InstallRoot $installed -StateRoot $temp -SkipCredential | Out-Null
  if($LASTEXITCODE -ne 0){throw 'remote-setup returned nonzero status'}
  $settings=Get-Content -Raw -LiteralPath (Join-Path $temp 'settings.json') | ConvertFrom-Json
  $profile=Get-Content -Raw -LiteralPath (Join-Path $temp 'profiles\micehole-personal.yaml')
  if($profile -notmatch [regex]::Escape($mock)){throw 'Generated profile does not select user Tunnel ID'}
  if($profile -notmatch 'api_key:.*env:CONTROL_PLANE_API_KEY'){throw 'Tunnel must use environment key reference, not plaintext YAML'}
  if($settings.tunnel_client -ne (Join-Path $installed 'tunnel-client\tunnel-client.exe')){throw 'Generated settings do not use bundled official client'}
  if(-not($profile.Contains('micehole.cmd'))){throw 'Personal profile does not call installed MCP server'}
  if(Test-Path -LiteralPath (Join-Path $temp 'runtime-key.dpapi')){throw 'SkipCredential must not create a secret'}
  Write-Output 'PERSONAL_TUNNEL_OFFLINE_ONBOARDING=PASS'
}finally{
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
