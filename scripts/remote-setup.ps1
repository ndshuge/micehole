[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$TunnelId,
  [Parameter(Mandatory=$true)][string]$TunnelClient,
  [string]$InstallRoot = '',
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'MiceHole\remote'),
  [string]$ProfileName = 'micehole-personal',
  [int]$HealthPort = 18791,
  [switch]$SkipCredential
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if([string]::IsNullOrWhiteSpace($InstallRoot)) { $InstallRoot = Split-Path -Parent $PSScriptRoot }
if($TunnelId -notmatch '^tunnel_[A-Za-z0-9_-]{12,128}$') { throw 'Invalid Tunnel ID format. Copy your own tunnel_id from OpenAI Platform.' }
if($ProfileName -notmatch '^[a-zA-Z0-9_-]{1,64}$') { throw 'Invalid profile name' }
if($HealthPort -lt 1024 -or $HealthPort -gt 65535) { throw 'HealthPort must be between 1024 and 65535' }
$client = (Resolve-Path -LiteralPath $TunnelClient -ErrorAction Stop).ProviderPath
if([IO.Path]::GetFileName($client).ToLowerInvariant() -ne 'tunnel-client.exe') { throw 'Select the official tunnel-client.exe executable' }
$runner = Join-Path $InstallRoot 'micehole.cmd'
if(-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw "MiceHole local MCP entry point missing: $runner" }
$profiles = Join-Path $StateRoot 'profiles'
$profilePath = Join-Path $profiles ($ProfileName + '.yaml')
$settings = Join-Path $StateRoot 'settings.json'
$keyFile = Join-Path $StateRoot 'runtime-key.dpapi'
if(Test-Path -LiteralPath $profilePath) { throw "Profile already exists: $profilePath. No changes made." }
if(Test-Path -LiteralPath $settings) { throw "Remote setup already exists: $settings. No changes made." }
New-Item -ItemType Directory -Path $profiles -Force | Out-Null
# Use the tunnel client's own validated profile generator rather than hand-written YAML.
$quotedCommand = '"' + $runner.Replace('\','/').Replace('"','') + '"'
& $client init --sample sample_mcp_stdio_local --profile-dir $profiles --profile $ProfileName --tunnel-id $TunnelId --mcp-command $quotedCommand --health-listen-addr ('127.0.0.1:' + $HealthPort)
if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $profilePath)) {
  throw 'tunnel-client init failed. Check the supplied tunnel ID, profile and client version.'
}
if(-not $SkipCredential) {
  $secure = Read-Host 'Paste your personal Tunnel runtime API key (hidden input)' -AsSecureString
  if($null -eq $secure -or $secure.Length -eq 0){ throw 'No runtime key entered. Profile preserved; run tunnel-save-key.ps1 after setup.' }
  $secure | ConvertFrom-SecureString | Set-Content -LiteralPath $keyFile -Encoding ASCII
  $secure.Dispose()
}
[ordered]@{
  version = 1
  tunnel_client = $client
  profile_name = $ProfileName
  profile_directory = $profiles
  health_port = $HealthPort
  local_mcp_entry = $runner
  generated_at_utc = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $settings -Encoding UTF8
Write-Output 'MICEHOLE_REMOTE_SETUP=PASS'
Write-Output "LOCAL_SETTINGS=$settings"
Write-Output "PROFILE=$profilePath"
Write-Output ('CREDENTIAL_SAVED=' + [bool](Test-Path -LiteralPath $keyFile))
Write-Output 'NEXT: run scripts\remote-doctor.ps1, then scripts\remote-run.ps1.'
Write-Output 'NEXT: In ChatGPT Plugins > Add custom MCP server > Tunnel, select your own tunnel ID.'
