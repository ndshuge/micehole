[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'Requires Windows'}
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Add-Type -Path (Join-Path $root 'src\worker\WindowsJobRunner.cs') -ErrorAction Stop
$qa=Join-Path $env:TEMP ('micehole-session-qa-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $qa | Out-Null
$hostFile=Join-Path $root 'scripts\tests\worker-session-host.ps1'
$dll=Join-Path $qa 'WorkerSessionFixture.dll'
$report=Join-Path $qa 'session-proof.json'
function Assert([bool]$truth,[string]$reason){if(-not $truth){throw $reason}}
try{
  Add-Type -Path (Join-Path $root 'src\worker\BoundedWorkerSession.cs') -OutputAssembly $dll -ErrorAction Stop
  # Host script is a tracked, separate test-only file.
  $powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $cmdArgs='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$hostFile+'" -Assembly "'+$dll+'" -Workspace "'+$qa+'" -Report "'+$report+'"'
  $job=[MiceHole.SecurityExperiment.WindowsJobRunner]::StartFixed($powershell,$cmdArgs,$qa)
  try{
    Assert ($job.Wait(30000)) 'Worker session host exceeded 30 second deadline'
    Assert ($job.ExitCode -eq 0) ('Worker host exited '+$job.ExitCode)
    Assert (Test-Path -LiteralPath $report) 'Session host did not create report'
    $data=Get-Content -LiteralPath $report -Raw|ConvertFrom-Json
    Assert ($data.ok) ('Session report failed: '+$data.error)
    foreach($k in @('streaming','nonzero_exit','truncation','timeout','cancel')){
      Assert ([bool]$data.$k) ('Worker session test missing: '+$k)
    }
    Write-Output 'WORKER_SESSION_INCREMENTAL_STDOUT_STDERR=PASS'
    Write-Output 'WORKER_SESSION_NONZERO_EXIT_AND_STATUS=PASS'
    Write-Output 'WORKER_SESSION_BOUNDED_TAIL_AND_TRUNCATION=PASS'
    Write-Output 'WORKER_SESSION_AUTOMATIC_TIMEOUT=PASS'
    Write-Output 'WORKER_SESSION_STOP=PASS'
    Write-Output 'WORKER_SESSION_INSIDE_WINDOWS_JOB=PASS'
    Write-Output 'PRODUCTION_REMOTE_EXECUTION=LOCKED'
  }finally{$job.Dispose()}
}finally{Remove-Item -LiteralPath $qa -Recurse -Force -ErrorAction SilentlyContinue}
