[CmdletBinding()]
param(
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'MiceHole\remote'),
  [ValidateRange(5,120)][int]$ProbeSeconds = 15,
  [switch]$DryRun,
  [ValidateRange(0,100000)][int]$MaxCycles = 0
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# User-level watchdog. Only stops the tunnel-client process it started itself.
# Does not touch the owner's existing production runtime or any other PID.
$settingsFile = Join-Path $StateRoot 'settings.json'
$keyFile = Join-Path $StateRoot 'runtime-key.dpapi'
if(-not(Test-Path -LiteralPath $settingsFile -PathType Leaf)){throw 'Personal Tunnel is not configured'}
$cfg = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
$client = (Resolve-Path -LiteralPath $cfg.tunnel_client -ErrorAction Stop).ProviderPath
if([IO.Path]::GetFileName($client) -ne 'tunnel-client.exe'){throw 'Unexpected tunnel client filename'}
$profile = Join-Path $cfg.profile_directory ($cfg.profile_name + '.yaml')
if(-not(Test-Path -LiteralPath $profile -PathType Leaf)){throw 'Tunnel profile does not exist'}
if(-not(Test-Path -LiteralPath $cfg.local_mcp_entry -PathType Leaf)){throw 'MiceHole executable does not exist'}
if($cfg.health_port -lt 1024 -or $cfg.health_port -gt 65535){throw 'Invalid loopback health port'}
if($cfg.profile_name -notmatch '^[a-zA-Z0-9_-]{1,64}$'){throw 'Invalid profile name'}
$profileData = Get-Content -LiteralPath $profile -Raw
if($profileData -notmatch '127\.0\.0\.1:'){throw 'Profile health listener must be loopback-only'}
if($profileData -notmatch 'api_key:\s*["'']?env:CONTROL_PLANE_API_KEY'){throw 'Profile must reference the runtime key via environment'}
if(-not(Test-Path -LiteralPath $keyFile -PathType Leaf) -and -not $DryRun){throw 'Encrypted runtime key missing'}
if($DryRun){
  [pscustomobject]@{
    ok=$true; mode='dry-run'; state_root=$StateRoot; client_present=$true
    profile_present=$true; key_present=(Test-Path -LiteralPath $keyFile)
    launch_disabled=$true; existing_sessions_untouched=$true
  } | ConvertTo-Json -Compress
  return
}
$mutex=New-Object Threading.Mutex($false,'Local\MiceHolePersonalTunnelSupervisorV1')
try{$acquired=$mutex.WaitOne(0,$false)}catch [Threading.AbandonedMutexException]{$acquired=$true}
if(-not $acquired){$mutex.Dispose();Write-Output 'MICEHOLE_SUPERVISOR_ALREADY_RUNNING';return}
$logs=Join-Path $StateRoot 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$journal=Join-Path $logs 'supervisor.ndjson'
$stateFile=Join-Path $StateRoot 'supervisor-state.json'
$stopFile=Join-Path $StateRoot 'stop.request'
$child=$null
$restartCount=0
$failureCount=0
$cycleCount=0
$startedUtc=[DateTime]::MinValue
function Publish([string]$state,[string]$action){
  $obj=[ordered]@{time=[DateTime]::UtcNow.ToString('o');state=$state;action=$action;
    pid=$(if($null -ne $child -and -not $child.HasExited){$child.Id}else{$null});restarts=$restartCount;failures=$failureCount}
  # Bound disk use and exclude all credentials, profile contents, command output or private paths.
  if((Test-Path -LiteralPath $journal) -and (Get-Item -LiteralPath $journal).Length -gt 1048576){
    Move-Item -LiteralPath $journal -Destination ($journal+'.old') -Force
  }
  $line=($obj | ConvertTo-Json -Compress)
  Add-Content -LiteralPath $journal -Value $line -Encoding UTF8
  $tmp=$stateFile+'.tmp'
  Set-Content -LiteralPath $tmp -Value $line -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $stateFile -Force
}
function Ready {
  try{
    $result=Invoke-WebRequest -Uri ('http://127.0.0.1:'+$cfg.health_port+'/readyz') -UseBasicParsing -TimeoutSec 3
    return $result.StatusCode -eq 200
  }catch{return $false}
}
function Launch {
  # Read/decrypt the key only when launching. The long-lived supervisor does not retain
  # the key in its environment after spawning the official tunnel-client.
  $secure=((Get-Content -LiteralPath $keyFile -Raw).Trim() | ConvertTo-SecureString)
  $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $key=$null
  try{$key=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)}
  finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr);$secure.Dispose()}
  if([string]::IsNullOrEmpty($key)){throw 'Empty Tunnel runtime key'}
  $previous=[Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY','Process')
  try{
    $env:CONTROL_PLANE_API_KEY=$key
    $arguments='run --profile-dir "'+$cfg.profile_directory+'" --profile "'+$cfg.profile_name+'"'
    $script:child=Start-Process -FilePath $client -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $script:startedUtc=[DateTime]::UtcNow
  }finally{
    $key=$null
    if($null -eq $previous){Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue}
    else{$env:CONTROL_PLANE_API_KEY=$previous}
  }
}
function Stop-Owned {
  if($null -eq $child){return}
  try{if(-not $child.HasExited){$child.Kill();$child.WaitForExit(5000)|Out-Null}}catch{}
  $script:child=$null
}
try{
  if(Test-Path -LiteralPath $stopFile){Remove-Item -LiteralPath $stopFile -Force}
  if(Ready){Publish 'PORT_BUSY' 'will_not_attach_to_unowned_tunnel';throw 'Tunnel health port already in use. Stop the existing manually started Tunnel before enabling Supervisor.'}
  do {
    if(Test-Path -LiteralPath $stopFile){Publish 'STOPPED' 'operator_requested';break}
    if($null -eq $child){
      if(Ready){Publish 'PORT_BUSY' 'will_not_kill_unowned_process';break}
      try{Launch;Publish 'STARTING' 'owned_client_launched'}
      catch{if($MaxCycles -gt 0){Write-Output ('START_EXCEPTION_TYPE='+ $_.Exception.GetType().Name+'; MESSAGE='+ $_.Exception.Message)};Publish 'START_ERROR' 'retry_safely';$cycleCount++;$restartCount++;if($MaxCycles -gt 0 -and $cycleCount -ge $MaxCycles){break};Start-Sleep -Seconds ([Math]::Min(60,5*[Math]::Pow(2,[Math]::Min(3,$restartCount))));continue}
      $failureCount=0
    }
    Start-Sleep -Seconds $ProbeSeconds
    $cycleCount++
    if(Test-Path -LiteralPath $stopFile){Publish 'STOPPED' 'operator_requested';break}
    if($child.HasExited){
      Publish 'TUNNEL_EXITED' 'retry_after_backoff';$script:child=$null;$restartCount++
      Start-Sleep -Seconds ([Math]::Min(60,5*[Math]::Pow(2,[Math]::Min(3,$restartCount))))
      continue
    }
    if(Ready){$failureCount=0;Publish 'HEALTHY' 'none'}
    else{
      $failureCount++
      Publish 'UNHEALTHY' 'probing'
      # Give the outbound connection a startup grace period before recovery.
      if($failureCount -ge 3 -and ([DateTime]::UtcNow-$startedUtc).TotalSeconds -ge 30){
        Publish 'RECOVERING' 'restart_owned_client'
        Stop-Owned
        $restartCount++
        Start-Sleep -Seconds ([Math]::Min(60,5*[Math]::Pow(2,[Math]::Min(3,$restartCount))))
      }
    }
  }while($MaxCycles -eq 0 -or $cycleCount -lt $MaxCycles)
}finally{
  Stop-Owned
  try{Publish 'STOPPED' 'supervisor_exit'}catch{}
  if(Test-Path -LiteralPath $stopFile){Remove-Item -LiteralPath $stopFile -Force}
  if($acquired){$mutex.ReleaseMutex()|Out-Null}
  $mutex.Dispose()
}
# Child non-zero exit codes are expected during successful recovery.
Write-Output 'MICEHOLE_SUPERVISOR_EXIT_OK'
exit 0
