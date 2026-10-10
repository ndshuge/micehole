param([string]$Assembly,[string]$Workspace,[string]$Report)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -Path $Assembly -ErrorAction Stop
$ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
function Assert([bool]$value,[string]$message){if(-not $value){throw $message}}
function CreateCase([string]$name,[string]$code){
  $path=Join-Path $Workspace ($name+'.ps1')
  Set-Content -LiteralPath $path -Value $code -Encoding UTF8
  return $path
}
function StartCase([string]$script,[int]$limitMs,[int]$cap){
  return [MiceHole.SecurityExperiment.BoundedWorkerSession]::StartFixedFixture(
    $ps,('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$script+'"'),
    $Workspace,$cap,$limitMs)
}
$result=[ordered]@{ok=$false;streaming=$false;nonzero_exit=$false;truncation=$false;timeout=$false;cancel=$false;error=''}
try{
  $case1=CreateCase 'stream' @'
[Console]::Out.WriteLine('OUT_A')
[Console]::Error.WriteLine('ERR_A')
Start-Sleep -Milliseconds 800
[Console]::Out.WriteLine('OUT_B')
[Console]::Error.WriteLine('ERR_B')
exit 7
'@
  $s=StartCase $case1 10000 1024
  try{
    Assert (-not $s.Wait(150)) 'Streaming fixture exited too early'
    $before=$s.Output(1024)
    # Allow asynchronous workers to drain bytes independently of root completion.
    for($i=0;$i -lt 30 -and (-not $before.Stdout.Contains('OUT_A'));$i++){
      Start-Sleep -Milliseconds 30
      $before=$s.Output(1024)
    }
    Assert ($before.Stdout.Contains('OUT_A')) 'Incremental stdout not visible before completion'
    Assert ($before.Stderr.Contains('ERR_A')) 'Incremental stderr not visible before completion'
    Assert ($s.Wait(8000)) 'Stream process never completed'
    $after=$s.Output(1024)
    $state=$s.Status()
    Assert ($after.Stdout.Contains('OUT_B') -and $after.Stderr.Contains('ERR_B')) 'Final mixed outputs missing'
    Assert ($state.ExitCode -eq 7) 'Nonzero test child exit status not preserved'
    Assert ($after.StdoutEof -and $after.StderrEof) 'Output streams not drained to EOF'
    $result.streaming=$true
    $result.nonzero_exit=$true
  }finally{$s.Dispose()}

  $case2=CreateCase 'truncate' @'
[Console]::Out.Write(('O'*6200)+'STDOUT_TAIL')
[Console]::Error.Write(('E'*6200)+'STDERR_TAIL')
exit 0
'@
  $s=StartCase $case2 9000 1024
  try{
    Assert ($s.Wait(7000)) 'Truncation child stuck'
    $o=$s.Output(512)
    Assert ($o.StdoutTruncated -and $o.StderrTruncated) 'Output cap did not report truncation'
    Assert ($o.StdoutBytesObserved -gt 6000 -and $o.StderrBytesObserved -gt 6000) 'Output bytes count incorrect'
    Assert ($o.Stdout.Contains('STDOUT_TAIL') -and $o.Stderr.Contains('STDERR_TAIL')) 'Tail output lost'
    Assert ($o.Stdout.Length -le 512 -and $o.Stderr.Length -le 512) 'Output response exceeded bound'
    $result.truncation=$true
  }finally{$s.Dispose()}

  $case3=CreateCase 'timeout' @'
[Console]::Out.WriteLine('TIMEOUT_STARTED')
Start-Sleep -Seconds 50
'@
  $s=StartCase $case3 1150 1024
  try{
    Assert ($s.Wait(7500)) 'Timeout did not kill stalled child'
    $t=$s.Status()
    Assert ($t.TimedOut -and -not $t.Running -and $t.ExitCode -ne 0) 'Timeout status invalid'
    $result.timeout=$true
  }finally{$s.Dispose()}

  $case4=CreateCase 'cancel' @'
[Console]::Error.WriteLine('CANCEL_STARTED')
Start-Sleep -Seconds 50
'@
  $s=StartCase $case4 10000 1024
  try{
    Assert (-not $s.Wait(100)) 'Cancel child exited before stop'
    $s.Stop()
    Assert ($s.Wait(4000)) 'Stop did not terminate child'
    $t=$s.Status()
    Assert ($t.CancelRequested -and -not $t.Running) 'Cancel state invalid'
    $result.cancel=$true
  }finally{$s.Dispose()}
  $result.ok=$true
}catch{$result.error=$_.Exception.GetType().Name+': '+$_.Exception.Message}
finally{$result|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $Report -Encoding UTF8}
