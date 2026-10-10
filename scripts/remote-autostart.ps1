[CmdletBinding()]
param(
  [ValidateSet('Status','Install','Start','Stop','Remove','DryRun')][string]$Action = 'Status',
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'MiceHole\remote')
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$taskName='MiceHole Personal Tunnel Supervisor'
$taskPath='\MiceHole\'
$fullName=$taskPath+$taskName
$supervisor=Join-Path $PSScriptRoot 'remote-supervisor.ps1'
$launcher=Join-Path $PSScriptRoot 'quiet-launch.vbs'
$settings=Join-Path $StateRoot 'settings.json'
$key=Join-Path $StateRoot 'runtime-key.dpapi'
$stopFlag=Join-Path $StateRoot 'stop.request'
$stateFile=Join-Path $StateRoot 'supervisor-state.json'
function Get-Existing {
  try{return Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction Stop}
  catch{
    if($_.Exception -is [Microsoft.Management.Infrastructure.CimException] -or $_.CategoryInfo.Category -eq 'ObjectNotFound'){return $null}
    throw
  }
}
function Report {
  $current=Get-Existing
  $last=$null
  if(Test-Path -LiteralPath $stateFile){
    try{$last=Get-Content -LiteralPath $stateFile -Raw|ConvertFrom-Json}catch{}
  }
  $stale=$true
  if($last -and $last.time){
    try{$stale=([DateTime]::UtcNow-[DateTime]::Parse($last.time).ToUniversalTime()).TotalSeconds -gt 120}catch{}
  }
  [ordered]@{
    installed=$null -ne $current
    enabled= $(if($current){[bool]$current.Settings.Enabled}else{$false})
    task_state= $(if($current){[string]$current.State}else{'Missing'})
    heartbeat_state= $(if($last){[string]$last.state}else{'Unknown'})
    heartbeat_stale=$stale
    supervised_pid=$(if($last){$last.pid}else{$null})
    retries=$(if($last){$last.restarts}else{0})
    has_config=(Test-Path -LiteralPath $settings)
    has_credential=(Test-Path -LiteralPath $key)
  } | ConvertTo-Json -Compress
}
if($Action -eq 'Status'){Report;return}
if($Action -eq 'DryRun'){
  if(-not(Test-Path -LiteralPath $settings)){throw 'Personal Tunnel settings missing'}
  if(-not(Test-Path -LiteralPath $supervisor)){throw 'Supervisor script missing'}
  if(-not(Test-Path -LiteralPath $launcher)){throw 'Windowless launcher missing'}
  Write-Output 'AUTOSTART_DRY_RUN=PASS_NO_TASK_CREATED'
  return
}
if($Action -eq 'Install'){
  if(Get-Existing){throw 'Task already registered; use Start, Stop or Remove'}
  if(-not(Test-Path -LiteralPath $settings)){throw 'Configure your personal Tunnel first'}
  if(-not(Test-Path -LiteralPath $key)){throw 'Save your own runtime key before enabling background connection'}
  if(-not(Test-Path -LiteralPath $supervisor) -or -not(Test-Path -LiteralPath $launcher)){throw 'Missing bundled Supervisor scripts'}
  if($StateRoot -ne (Join-Path $env:LOCALAPPDATA 'MiceHole\remote')){throw 'Autostart supports only default per-user state root'}
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  $action=New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('//B //NoLogo "'+$launcher+'" "'+$supervisor+'"')
  $logon=New-ScheduledTaskTrigger -AtLogOn -User $user
  $repeat=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
  $taskSettings=New-ScheduledTaskSettingsSet -Hidden -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $action -Trigger @($logon,$repeat) -Settings $taskSettings -Principal $principal -Description 'Opt-in user-level personal Tunnel watchdog, checked periodically' | Out-Null
  Write-Output 'AUTOSTART_INSTALLED=TRUE; use -Action Start to launch now'
  return
}
if($Action -eq 'Start'){
  if(-not(Get-Existing)){throw 'No MiceHole personal scheduled task is installed'}
  if(Test-Path -LiteralPath $stopFlag){Remove-Item -LiteralPath $stopFlag -Force}
  Enable-ScheduledTask -TaskName $taskName -TaskPath $taskPath | Out-Null
  Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath
  Write-Output 'AUTOSTART_START_REQUESTED=TRUE; verify -Action Status after health is ready'
  return
}
if($Action -eq 'Stop' -or $Action -eq 'Remove'){
  $existing=Get-Existing
  if($existing){
    Disable-ScheduledTask -TaskName $taskName -TaskPath $taskPath | Out-Null
    New-Item -ItemType Directory -Force -Path $StateRoot|Out-Null
    Set-Content -LiteralPath $stopFlag -Value 'operator-requested-stop' -Encoding ASCII
    if($Action -eq 'Remove'){Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false}
  }
  Write-Output ($Action.ToUpperInvariant()+'_REQUESTED=TRUE; only MiceHole-owned child is stopped by Supervisor')
}
