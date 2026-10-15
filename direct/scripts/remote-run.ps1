[CmdletBinding()]
param([string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'MiceHoleV3\remote'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$settings=Join-Path $StateRoot 'settings.json'
$keyFile=Join-Path $StateRoot 'runtime-key.dpapi'
if(-not(Test-Path -LiteralPath $settings -PathType Leaf)) { throw 'Missing remote settings: run remote-setup.ps1' }
if(-not(Test-Path -LiteralPath $keyFile -PathType Leaf)) { throw 'Missing encrypted API key: run remote-save-key.ps1' }
$cfg=Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
if(-not(Test-Path -LiteralPath $cfg.tunnel_client -PathType Leaf)){throw 'Missing tunnel-client executable'}
if(-not(Test-Path -LiteralPath $cfg.local_mcp_entry -PathType Leaf)){throw 'Missing MiceHole MCP server entry'}
$mutexName = 'Local\MiceHolePublicRemoteTunnelV1'
$mutex = New-Object System.Threading.Mutex($false,$mutexName)
try {$acquired=$mutex.WaitOne(0,$false)} catch [Threading.AbandonedMutexException]{$acquired=$true}
if(-not $acquired){$mutex.Dispose(); Write-Output 'ALREADY_RUNNING'; exit 0}
$previous=[Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','Process')
try {
  $secret=(Get-Content -LiteralPath $keyFile -Raw).Trim() | ConvertTo-SecureString
  $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  try {$key=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)}
  finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)}
  if([string]::IsNullOrWhiteSpace($key)){throw 'Empty runtime key'}
  $env:CONTROL_PLANE_API_KEY=$key
  $key=$null
  & $cfg.tunnel_client run --profile-dir $cfg.profile_directory --profile $cfg.profile_name
  if($LASTEXITCODE -ne 0){throw ('tunnel-client exited with code '+ $LASTEXITCODE)}
}finally{
  if($null -eq $previous){Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue}
  else{$env:CONTROL_PLANE_API_KEY=$previous}
  if($acquired){$mutex.ReleaseMutex() | Out-Null}
  $mutex.Dispose()
}
