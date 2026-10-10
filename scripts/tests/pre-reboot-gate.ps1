[CmdletBinding()]
param(
  [switch]$SkipInstaller,
  [switch]$SkipSupervisor,
  [string]$ProtectedPorts = ''
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$evidence=Join-Path $repo 'qa-fixture\pre-reboot-gate'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$tests=New-Object System.Collections.Generic.List[object]
$started=[DateTime]::UtcNow
$node=(Get-Command node.exe -ErrorAction Stop).Source
$ps=(Get-Command powershell.exe -ErrorAction Stop).Source
function Get-Ports {
  $rows=@()
  foreach($portString in ($ProtectedPorts -split '[,; ]+' | Where-Object {$_ -match '^\d{1,5}$'})){
    $port=[int]$portString
    if($port -le 0 -or $port -gt 65535){throw 'Port number out of range'}
    $listeners=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach($entry in @($listeners)){
      if($null -ne $entry){$rows+=('{0}:{1}' -f $port,$entry.OwningProcess)}
    }
  }
  return @($rows|Sort-Object)
}
$before=@(Get-Ports)
function Step([string]$name,[string]$executable,[string]$arguments) {
  $log=Join-Path $evidence ($name+'.stdout.txt')
  $err=Join-Path $evidence ($name+'.stderr.txt')
  Remove-Item -LiteralPath $log,$err -Force -ErrorAction SilentlyContinue
  $result=$null
  $startedAt=[DateTime]::UtcNow
  try {
    $p=Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $repo -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err
    $code=if($null -eq $p.ExitCode){-777}else{[int]$p.ExitCode}
    $ok=$code -eq 0
    $result=[ordered]@{name=$name;passed=$ok;exit_code=$code;elapsed_s=[Math]::Round(([DateTime]::UtcNow-$startedAt).TotalSeconds,1)}
  }catch{
    $result=[ordered]@{name=$name;passed=$false;exit_code=-999;error=$_.Exception.Message}
  }
  $tests.Add($result)
  if($result.passed){Write-Host ('PASS '+$name)}
  else{
    Write-Host ('FAIL '+$name+' exit='+$result.exit_code)
    if(Test-Path -LiteralPath $err){Get-Content -LiteralPath $err -Tail 10 | ForEach-Object {Write-Output ('DETAIL '+$_)}}
    if(Test-Path -LiteralPath $log){Get-Content -LiteralPath $log -Tail 10 | ForEach-Object {Write-Output ('DETAIL '+$_)}}
  }
  return $result.passed
}
$ok=$true
try{
  $ok=(Step 'MCP_SMOKE' $node 'scripts\smoke-test.mjs') -and $ok
  $ok=(Step 'SECURITY_NEGATIVE' $node 'scripts\security-test.mjs') -and $ok
  $ok=(Step 'WORKER_IPC_FIXTURE' $node 'scripts\tests\worker-ipc.test.mjs') -and $ok
  $ok=(Step 'WINDOWS_PEER_SID_NEGATIVE' $ps '-NoProfile -ExecutionPolicy Bypass -File scripts\tests\verify-windows-pipe-peer.ps1') -and $ok
  $ok=(Step 'WORKER_JOB_OBJECT' $ps '-NoProfile -ExecutionPolicy Bypass -File scripts\tests\verify-worker-job-ci.ps1') -and $ok
  $ok=(Step 'WORKER_SESSION_STREAMING' $ps '-NoProfile -ExecutionPolicy Bypass -File scripts\tests\verify-worker-session-ci.ps1') -and $ok
  $ok=(Step 'SCRIPT_SYNTAX' $ps '-NoProfile -ExecutionPolicy Bypass -File scripts\check-remote-syntax.ps1') -and $ok
  $ok=(Step 'PERSONAL_TUNNEL_OFFLINE' $ps '-NoProfile -ExecutionPolicy Bypass -File scripts\verify-tunnel-onboarding.ps1') -and $ok
  $ok=(Step 'INSTALLER_CONTRACT' $ps '-NoProfile -ExecutionPolicy Bypass -File scripts\verify-installer-contract.ps1') -and $ok
  $ok=(Step 'PORTABLE_ARTIFACT' $ps '-NoProfile -ExecutionPolicy Bypass -File scripts\verify-portable.ps1') -and $ok
  if(-not $SkipSupervisor){$ok=(Step 'SUPERVISOR_SIMULATED_CRASH' $ps '-NoProfile -ExecutionPolicy Bypass -File scripts\tests\verify-supervisor.ps1') -and $ok}
  if(-not $SkipInstaller){$ok=(Step 'REAL_SILENT_INSTALL_UNINSTALL' $ps '-NoProfile -ExecutionPolicy Bypass -File scripts\tests\verify-installer-lifecycle.ps1') -and $ok}
  $ok=(Step 'NO_SECRET_PUBLISH_PREFLIGHT' $node 'scripts\public-preflight.mjs') -and $ok
}finally{
  $after=@(Get-Ports)
  $portInvariant=($before -join ',') -eq ($after -join ',')
  if(-not $portInvariant){$ok=$false;Write-Output 'FAIL protected_port_owner_changed'}
  $installTask=Get-ScheduledTask -TaskName 'MiceHole Personal Tunnel Supervisor' -TaskPath '\MiceHole\' -ErrorAction SilentlyContinue
  $taskInvariant=$null -eq $installTask
  if(-not $taskInvariant){$ok=$false;Write-Output 'FAIL unexpected_personal_autostart_task'}
  $gitHash=(& git -C $repo rev-parse --short HEAD) -join ''
  $setup=Join-Path $repo 'dist\installer\MiceHole-Universal-0.1.0-Setup.exe'
  $zip=Join-Path $repo 'dist\MiceHole-Universal-0.1.0-Windows-x64.zip'
  $report=[ordered]@{
    recorded_utc=[DateTime]::UtcNow.ToString('o')
    started_utc=$started.ToString('o')
    commit=$gitHash.Trim()
    pre_reboot_ready=$ok
    public_release_ready=$false
    did_reboot=$false
    created_windows_account=$false
    modified_production_tunnel=$false
    protected_ports_unchanged=$portInvariant
    protected_port_processes_before=$before
    protected_port_processes_after=$after
    unexpected_public_autostart_task=$null -ne $installTask
    setup_sha256=if(Test-Path -LiteralPath $setup){(Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash}else{$null}
    zip_sha256=if(Test-Path -LiteralPath $zip){(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash}else{$null}
    tests=$tests.ToArray()
    post_gate_blockers=@(
      'production worker with dedicated Windows security boundary and actual Tunnel credential ACL is not implemented; disposable LocalService proof does not substitute',
      'real separate-user OpenAI Tunnel/ChatGPT web and phone pairing not validated',
      'cold reboot + logon autostart + sleep/wake and proxy recovery untested',
      'public security review / supported account matrix and external Beta consent pending'
    )
  }
  $out=Join-Path $evidence 'report.json'
  $report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
  Write-Output ('GATE_REPORT='+$out)
  Write-Output ('PRE_REBOOT_GATE='+$(if($ok){'PASS'}else{'FAIL'}))
  Write-Output 'PUBLIC_RELEASE_GATE=BLOCKED'
}
if(-not $ok){exit 1}
