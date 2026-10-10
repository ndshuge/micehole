[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# Never execute on owner's physical computer: this test uses the ephemeral GH runner only.
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows'){
  throw 'Refusing OS account/task/ACL test outside disposable GitHub-hosted Windows runner'
}
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runId=[Guid]::NewGuid().ToString('N')
$qa=Join-Path $env:RUNNER_TEMP ('micehole-sid-ci-'+$runId)
$private=Join-Path $qa 'broker-only'
$workspace=Join-Path $qa 'worker-space'
$taskName='MiceHole Worker Identity QA '+$runId
$taskPath='\MiceHoleWorkerCI\'
$workerSid='S-1-5-19' # Windows built-in LocalService, not a new user.
$brokerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if($brokerSid -eq $workerSid){throw 'Runner unexpectedly uses LocalService already'}
$registered=$false
$reportFile=Join-Path $root 'qa-fixture\worker-sid-ci-proof.json'
function Set-ScopedFolderAcl([string]$dir,[bool]$workerCanWrite){
  $acl=Get-Acl -LiteralPath $dir
  $acl.SetAccessRuleProtection($true,$false)
  $flags=[Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $prop=[Security.AccessControl.PropagationFlags]::None
  $allow=[Security.AccessControl.AccessControlType]::Allow
  foreach($entry in @(@($brokerSid,'FullControl'),@('S-1-5-18','FullControl'))){
    $principal=New-Object Security.Principal.SecurityIdentifier($entry[0])
    $rights=[Security.AccessControl.FileSystemRights]::FullControl
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($principal,$rights,$flags,$prop,$allow)
    $acl.AddAccessRule($rule)
  }
  if($workerCanWrite){
    $rule=New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($workerSid)),
      [Security.AccessControl.FileSystemRights]::Modify,$flags,$prop,$allow)
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $dir -AclObject $acl
}
try{
  New-Item -ItemType Directory -Force -Path $private,$workspace | Out-Null
  $dummy=Join-Path $private 'runtime-key.dpapi'
  $secure=ConvertTo-SecureString 'CI_ONLY_DUMMY_NO_REAL_TOKEN' -AsPlainText -Force
  try{($secure|ConvertFrom-SecureString) | Set-Content -LiteralPath $dummy -Encoding ASCII}
  finally{$secure.Dispose()}
  Set-ScopedFolderAcl $private $false
  Set-ScopedFolderAcl $workspace $true
  $script=Join-Path $workspace 'identity-probe.ps1'
  $resultPath=Join-Path $workspace 'worker-proof.json'
  $body=@'
$ErrorActionPreference='Stop'
$me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$denied=$false
try{
  [void](Get-Content -LiteralPath '__SECRET_PATH__' -Raw -ErrorAction Stop)
}catch [System.UnauthorizedAccessException]{$denied=$true}
catch [System.IO.IOException]{$denied=$true}
$written=$false
try{Set-Content -LiteralPath '__WORKSPACE_WRITE__' -Value 'SAFE_WORKSPACE_ONLY' -Encoding ASCII -ErrorAction Stop;$written=$true}catch{}
[ordered]@{
  local_service_sid=($me -eq 'S-1-5-19')
  credential_read_denied=$denied
  workspace_write=$written
  no_sensitive_env=([string]::IsNullOrEmpty($env:CONTROL_PLANE_API_KEY) -and [string]::IsNullOrEmpty($env:OPENAI_API_KEY))
} | ConvertTo-Json | Set-Content -LiteralPath '__RESULT_PATH__' -Encoding UTF8
'@
  $body=$body.Replace('__SECRET_PATH__',$dummy.Replace("'","''")).Replace('__WORKSPACE_WRITE__',(Join-Path $workspace 'work.txt').Replace("'","''")).Replace('__RESULT_PATH__',$resultPath.Replace("'","''"))
  Set-Content -LiteralPath $script -Value $body -Encoding UTF8
  $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$script+'"')
  $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5)
  $principal=New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
  Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  $registered=$true
  Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath
  for($i=0;$i -lt 25 -and -not(Test-Path -LiteralPath $resultPath);$i++){Start-Sleep -Seconds 1}
  if(-not(Test-Path -LiteralPath $resultPath)){throw 'Low-privilege test process produced no result; check Task Scheduler and ACLs'}
  $proof=Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
  if(-not $proof.local_service_sid){throw 'Worker did not run as LocalService SID'}
  if(-not $proof.credential_read_denied){throw 'Worker read the broker credential despite intended ACL'}
  if(-not $proof.workspace_write){throw 'Worker cannot write approved workspace'}
  if(-not $proof.no_sensitive_env){throw 'Worker inherited a sensitive API key'}
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportFile)|Out-Null
  [ordered]@{ok=$true;guest_sid='LocalService/S-1-5-19';distinct_sid_proven=$true;
    broker_dummy_credential_denied=$true;approved_workspace_write=$true;
    production_user_modified=$false;real_tunnel_used=$false;reboot_performed=$false;
    caveat='Disposable CI task only. No Broker IPC ACL or production credential separation implemented.'} |
    ConvertTo-Json | Set-Content -LiteralPath $reportFile -Encoding UTF8
  Write-Output 'WORKER_DIFFERENT_WINDOWS_SID=PASS'
  Write-Output 'WORKER_BROKER_DUMMY_CREDENTIAL_DENIED=PASS'
  Write-Output 'WORKER_APPROVED_WORKSPACE_WRITE=PASS'
  Write-Output 'NO_WINDOWS_USER_CREATED_OR_REBOOTED=PASS'
}finally{
  if($registered){Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false -ErrorAction SilentlyContinue}
  # Only the task above is ever registered. The ephemeral CI runner is discarded.
  Remove-Item -LiteralPath $qa -Recurse -Force -ErrorAction SilentlyContinue
}
