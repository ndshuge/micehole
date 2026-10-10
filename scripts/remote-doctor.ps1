[CmdletBinding()]
param(
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'MiceHole\remote'),
  [switch]$Deep,
  [switch]$ConfigurationOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$settings = Join-Path $StateRoot 'settings.json'
$keyFile = Join-Path $StateRoot 'runtime-key.dpapi'
$report = [ordered]@{
  ready = $false
  configured = $false
  settings_present = Test-Path -LiteralPath $settings -PathType Leaf
  key_present = Test-Path -LiteralPath $keyFile -PathType Leaf
  client_present = $false
  profile_present = $false
  mcp_present = $false
  tunnel_health = 'not_checked'
  tunnel_doctor_exit = $null
  message = ''
}
try {
  if(-not $report.settings_present) { throw 'Run remote-setup.ps1 to configure your personal Tunnel.' }
  $cfg = Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
  $report.client_present = Test-Path -LiteralPath $cfg.tunnel_client -PathType Leaf
  $report.profile_present = Test-Path -LiteralPath (Join-Path $cfg.profile_directory ($cfg.profile_name + '.yaml')) -PathType Leaf
  $report.mcp_present = Test-Path -LiteralPath $cfg.local_mcp_entry -PathType Leaf
  if(-not $report.client_present -or -not $report.profile_present -or -not $report.mcp_present){ throw 'One or more local runtime files are missing.' }
  $url = 'http://127.0.0.1:' + $cfg.health_port + '/readyz'
  try {
    $reply = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    $report.tunnel_health = if($reply.StatusCode -eq 200){ 'ready' }else{ 'not_ready' }
  }catch{ $report.tunnel_health = 'stopped_or_unhealthy' }
  if($Deep) {
    if(-not $report.key_present) { throw 'Runtime API key not configured: run remote-save-key.ps1.' }
    $previous = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','Process')
    try {
      $secret = (Get-Content -LiteralPath $keyFile -Raw).Trim() | ConvertTo-SecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
      try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
      if([string]::IsNullOrWhiteSpace($key)) {throw 'Empty runtime API key'}
      $env:CONTROL_PLANE_API_KEY = $key
      $key = $null
      # Diagnostic output can include local paths; it intentionally excludes key material.
      & $cfg.tunnel_client doctor --profile-dir $cfg.profile_directory --profile $cfg.profile_name --explain *> $null
      $report.tunnel_doctor_exit = $LASTEXITCODE
    }finally{
      if($null -eq $previous) {Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue}
      else{$env:CONTROL_PLANE_API_KEY = $previous}
    }
  }
  $report.configured = $report.settings_present -and $report.key_present -and $report.client_present -and $report.profile_present -and $report.mcp_present -and (!$Deep -or $report.tunnel_doctor_exit -eq 0)
  $report.ready = $report.configured -and $report.tunnel_health -eq 'ready'
  if($report.ready) { $report.message = 'Personal Tunnel is ready. Check ChatGPT tool discovery separately.' }
  elseif($report.configured) { $report.message = 'Setup configured; Tunnel not connected yet. Start remote-run.ps1 then repeat.' }
  else { $report.message = 'Remote setup incomplete. Review missing fields or failed deep doctor.' }
}catch{
  $report.message = $_.Exception.Message
}
[pscustomobject]$report | ConvertTo-Json -Compress
if($ConfigurationOnly) { if(-not $report.configured) { exit 1 } }
elseif(-not $report.ready) { exit 1 }
