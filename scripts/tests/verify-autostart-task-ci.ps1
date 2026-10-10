[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# This test mutates Windows Task Scheduler. Only run on disposable GitHub-hosted CI.
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted'){
  throw 'Refusing to change Task Scheduler outside disposable GitHub-hosted Actions runner.'
}
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$manager=Join-Path $repo 'scripts\remote-autostart.ps1'
$taskName='MiceHole Personal Tunnel Supervisor'
$taskPath='\MiceHole\'
$state=Join-Path $env:LOCALAPPDATA 'MiceHole\remote'
$created=$false
$registered=$false
if($null -ne (Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue)){throw 'Task already exists, refusing to modify'}
if(Test-Path -LiteralPath $state){throw 'Remote state exists, refusing to overwrite'}
try{
  New-Item -ItemType Directory -Path $state -Force|Out-Null
  $created=$true
  @{version=1;profile_name='TEST_NO_REAL_TUNNEL';health_port=65001} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'settings.json') -Encoding UTF8
  $secure=ConvertTo-SecureString 'CI_TEST_CREDENTIAL_NOT_REAL' -AsPlainText -Force
  try{$secure|ConvertFrom-SecureString|Set-Content -LiteralPath (Join-Path $state 'runtime-key.dpapi') -Encoding ASCII}
  finally{$secure.Dispose()}
  & $manager -Action Install
  $registered=$true
  $task=Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction Stop
  if(-not $task){throw 'Task was not registered'}
  if($task.Actions.Count -ne 1 -or $task.Actions[0].Execute -notmatch '(?i)wscript\.exe$'){throw 'Task launcher is not the expected quiet script'}
  if([string]$task.Principal.RunLevel -match '(?i)Highest'){throw 'Task unexpectedly requests elevated privileges'}
  # Do not Start-ScheduledTask. Only verify registration, status and removal.
  $status=(& $manager -Action Status | ConvertFrom-Json)
  if(-not $status.installed){throw 'Status failed to recognize installed task'}
  & $manager -Action Remove
  $registered=$false
  if($null -ne (Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue)){throw 'Task remains after Remove'}
  Write-Output 'WINDOWS_TASK_INSTALL_REMOVE=PASS'
  Write-Output 'NO_REAL_TUNNEL_OR_REBOOT=PASS'
}finally{
  if($registered){
    try{& $manager -Action Remove|Out-Null}catch{}
  }
  if($created){Remove-Item -LiteralPath $state -Recurse -Force -ErrorAction SilentlyContinue}
}
