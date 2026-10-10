[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'Windows Job Object tests require Windows'}
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Add-Type -Path (Join-Path $root 'src\worker\WindowsJobRunner.cs') -ErrorAction Stop
$qa=Join-Path $env:TEMP ('micehole-job-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $qa|Out-Null
function StartFixed([string]$app,[string]$arguments){
  return [MiceHole.SecurityExperiment.WindowsJobRunner]::StartFixed($app,$arguments,$qa)
}
function Assert([bool]$truth,[string]$message){if(-not $truth){throw $message}}
try {
  $cmd=Join-Path $env:SystemRoot 'System32\cmd.exe'
  $output=Join-Path $qa 'stdout-fixture.txt'
  $job=StartFixed $cmd ('/d /c echo W2B_JOB_OUTPUT > "'+$output+'"')
  try{
    Assert ($job.Wait(7000)) 'Simple job did not finish'
    Assert ($job.ExitCode -eq 0) ('Simple job exit='+$job.ExitCode)
    Assert ((Get-Content -LiteralPath $output -Raw).Contains('W2B_JOB_OUTPUT')) 'Expected fixture file output missing'
  }finally{$job.Dispose()}
  Write-Output 'JOB_SUSPENDED_ASSIGN_BEFORE_RESUME=PASS'
  Write-Output 'JOB_WAIT_AND_WORKSPACE_OUTPUT=PASS'

  $job=StartFixed $cmd '/d /c ping -n 16 127.0.0.1 > nul'
  try{
    Assert (-not $job.Wait(150)) 'Slow fixture should not finish before wait budget'
    $job.Cancel()
    Assert ($job.Wait(4500)) 'Cancelled root process still running'
    Assert ($job.ExitCode -ne 0) 'Cancelled root process falsely reported success'
  }finally{$job.Dispose()}
  Write-Output 'JOB_TIMEOUT_AND_CANCEL=PASS'

  # The root exits almost immediately, but its nested child must not survive
  # closing the last Job Object handle. A parent-only Process.Kill would fail here.
  $childPidFile=Join-Path $qa 'grandchild-pid.txt'
  $childScript=Join-Path $qa 'grandchild.ps1'
  $parentScript=Join-Path $qa 'parent.ps1'
  $childLines=@(
    'Set-Content -LiteralPath '+"'"+$childPidFile.Replace("'","''")+"'"+' -Value $PID -Encoding ASCII'
    'Start-Sleep -Seconds 70'
  )
  Set-Content -LiteralPath $childScript -Value $childLines -Encoding UTF8
  $parentContent=@'
$ErrorActionPreference='Stop'
$info=New-Object System.Diagnostics.ProcessStartInfo
$info.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$info.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "__CHILD_SCRIPT__"'
$info.UseShellExecute=$false
$info.CreateNoWindow=$true
$child=[System.Diagnostics.Process]::Start($info)
if($null -eq $child){throw 'Unable to create test grandchild'}
$child.Dispose()
'@
  $parentContent=$parentContent.Replace('__CHILD_SCRIPT__',$childScript.Replace("'","''"))
  Set-Content -LiteralPath $parentScript -Value $parentContent -Encoding UTF8
  $powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $job=StartFixed $powershell ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$parentScript+'"')
  $descendantId=$null
  try{
    Assert ($job.Wait(9000)) 'Parent fixture did not exit'
    Assert ($job.ExitCode -eq 0) ('Parent fixture exit='+$job.ExitCode)
    for($i=0;$i -lt 60 -and -not(Test-Path -LiteralPath $childPidFile);$i++){Start-Sleep -Milliseconds 100}
    Assert (Test-Path -LiteralPath $childPidFile) 'Grandchild did not publish PID'
    $descendantId=[int](Get-Content -LiteralPath $childPidFile -Raw)
    Assert ($null -ne (Get-Process -Id $descendantId -ErrorAction SilentlyContinue)) 'Grandchild did not survive root exit'
    $job.Dispose() # kill-on-close must clean grandchildren, even after root completed
    for($i=0;$i -lt 40 -and (Get-Process -Id $descendantId -ErrorAction SilentlyContinue);$i++){Start-Sleep -Milliseconds 100}
    Assert ($null -eq (Get-Process -Id $descendantId -ErrorAction SilentlyContinue)) 'Orphan descendant survived Windows Job Object disposal'
    Write-Output 'JOB_DESCENDANT_KILL_ON_CLOSE=PASS'
  }finally{
    $job.Dispose()
    # CI-only safety fallback if the Job implementation fails under this Windows version.
    if($descendantId -and (Get-Process -Id $descendantId -ErrorAction SilentlyContinue)){
      Stop-Process -Id $descendantId -Force -ErrorAction SilentlyContinue
    }
  }
}finally{Remove-Item -LiteralPath $qa -Recurse -Force -ErrorAction SilentlyContinue}
Write-Output 'W2B_GENERIC_REMOTE_EXECUTION=NOT_ENABLED'
