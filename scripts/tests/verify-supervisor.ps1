[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$scriptRoot=Split-Path -Parent $PSScriptRoot
$temp=Join-Path ([IO.Path]::GetTempPath()) ('micehole-watchdog-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp -Force|Out-Null
$started=$null
$oldPort=$env:MICEHOLE_STUB_PORT
$oldMarker=$env:MICEHOLE_STUB_CRASH_MARKER
try {
  $fake=Join-Path $temp 'tunnel-client.exe'
  Add-Type -Path (Join-Path $PSScriptRoot 'fake-tunnel.cs') -OutputAssembly $fake -OutputType ConsoleApplication -ErrorAction Stop
  $probe=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
  $probe.Start();$port=$probe.LocalEndpoint.Port;$probe.Stop()
  $profileDir=Join-Path $temp 'profiles'
  New-Item -ItemType Directory -Path $profileDir -Force|Out-Null
  $entry=Join-Path $temp 'micehole.cmd'
  Set-Content -LiteralPath $entry -Value '@echo off' -Encoding ASCII
  $yaml="control_plane:$([Environment]::NewLine)  api_key: 'env:CONTROL_PLANE_API_KEY'$([Environment]::NewLine)health:$([Environment]::NewLine)  listen_addr: '127.0.0.1:$port'"
  Set-Content -LiteralPath (Join-Path $profileDir 'micehole-personal.yaml') -Value $yaml -Encoding ASCII
  $settings=[ordered]@{tunnel_client=$fake;profile_name='micehole-personal';profile_directory=$profileDir;health_port=$port;local_mcp_entry=$entry}
  $settings|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $temp 'settings.json') -Encoding UTF8
  $key=ConvertTo-SecureString 'TEST_ONLY_NOT_REAL_CONTROL_KEY' -AsPlainText -Force
  try { $key|ConvertFrom-SecureString|Set-Content -LiteralPath (Join-Path $temp 'runtime-key.dpapi') -Encoding ASCII }
  finally {$key.Dispose()}
  $env:MICEHOLE_STUB_PORT=[string]$port
  $env:MICEHOLE_STUB_CRASH_MARKER=Join-Path $temp 'first-run-marker'
  $supervisor=Join-Path $scriptRoot 'remote-supervisor.ps1'
  $out=Join-Path $temp 'stdout.log'
  $err=Join-Path $temp 'stderr.log'
  $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$supervisor+'" -StateRoot "'+$temp+'" -ProbeSeconds 5 -MaxCycles 3'
  $started=Start-Process -FilePath 'powershell.exe' -ArgumentList $args -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
  if(-not $started.WaitForExit(75000)){throw 'Watchdog did not finish within 75 sec'}
  $outputText=Get-Content -LiteralPath $out -Raw -ErrorAction SilentlyContinue
  if($outputText -notmatch 'MICEHOLE_SUPERVISOR_EXIT_OK'){throw ('Supervisor did not report a successful controlled shutdown. ExitCode='+$started.ExitCode)}
  $stderrText=Get-Content -LiteralPath $err -Raw -ErrorAction SilentlyContinue
  if(-not [string]::IsNullOrWhiteSpace($stderrText)){throw ('Supervisor printed error: '+$stderrText)}
  $journal=Join-Path $temp 'logs\supervisor.ndjson'
  if(-not(Test-Path -LiteralPath $journal)){throw 'Missing supervisor journal'}
  $entries=@(Get-Content -LiteralPath $journal|ForEach-Object{$_|ConvertFrom-Json})
  if(-not($entries|Where-Object {$_.state -eq 'HEALTHY'})){throw 'Stub never reached ready state'}
  if(-not($entries|Where-Object {$_.state -eq 'TUNNEL_EXITED'})){throw 'Stub simulated crash was not detected'}
  if(-not($entries|Where-Object {$_.state -eq 'HEALTHY' -and $_.restarts -ge 1})){throw 'Supervisor did not regain healthy status after crash'}
  if($entries[-1].state -ne 'STOPPED'){throw 'Supervisor did not terminate owned child after bounded test'}
  $lastPid=$entries[-1].pid
  if($null -ne $lastPid){throw 'Unexpected owned process after supervisor exit'}
  Write-Output 'SUPERVISOR_CRASH_RECOVERY=PASS'
  Write-Output 'SUPERVISOR_STOP_OWNED_CHILD=PASS'
  Write-Output 'SUPERVISOR_NO_LIVE_TUNNEL_CHANGED=PASS'
}catch{
  $stdoutFile=Join-Path $temp 'stdout.log'
  if(Test-Path -LiteralPath $stdoutFile){Get-Content -LiteralPath $stdoutFile -Tail 20 | ForEach-Object {Write-Output ('WATCHDOG_STDOUT='+$_)}}
  $diagnostic=Join-Path $temp 'logs\supervisor.ndjson'
  if(Test-Path -LiteralPath $diagnostic){Get-Content -LiteralPath $diagnostic -Tail 14 | ForEach-Object{Write-Output ('WATCHDOG_TRACE='+$_)}}
  $stderrFile=Join-Path $temp 'stderr.log'
  if(Test-Path -LiteralPath $stderrFile){Get-Content -LiteralPath $stderrFile -Tail 15 | ForEach-Object{Write-Output ('WATCHDOG_ERROR='+$_)}}
  throw
}finally {
  if($started -and -not $started.HasExited){try{$started.Kill()}catch{}}
  if($null -eq $oldPort){Remove-Item Env:MICEHOLE_STUB_PORT -ErrorAction SilentlyContinue}else{$env:MICEHOLE_STUB_PORT=$oldPort}
  if($null -eq $oldMarker){Remove-Item Env:MICEHOLE_STUB_CRASH_MARKER -ErrorAction SilentlyContinue}else{$env:MICEHOLE_STUB_CRASH_MARKER=$oldMarker}
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
