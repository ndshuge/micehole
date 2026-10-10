[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

# This is an OS-mutating test. Refuse any machine other than ephemeral GitHub-hosted Windows.
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows'){
  throw 'W2-A different-SID pipe integration may run only on disposable GitHub-hosted Windows'
}
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$nonce=[Guid]::NewGuid().ToString('N')
$qa=Join-Path $env:RUNNER_TEMP ('micehole-w2a-'+$nonce)
$secretDir=Join-Path $qa 'broker-only'
$workspace=Join-Path $qa 'authorized-workspace'
$pipeName='MiceHole-W2A-'+$nonce
$taskName='MiceHole W2A Pipe QA '+$nonce
$taskPath='\MiceHoleWorkerCI\'
$workerSid='S-1-5-19'
$brokerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskRegistered=$false
$reportFile=Join-Path $repo 'qa-fixture\worker-pipe-ci-proof.json'
if($workerSid -eq $brokerSid){throw 'Unexpected worker/broker same Windows SID'}
function RestrictDirectory([string]$target,[bool]$workerWrite) {
  $acl=Get-Acl -LiteralPath $target
  $acl.SetAccessRuleProtection($true,$false)
  $flags=[Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $prop=[Security.AccessControl.PropagationFlags]::None
  $allow=[Security.AccessControl.AccessControlType]::Allow
  foreach($id in @($brokerSid,'S-1-5-18')) {
    $rule=New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($id)),
      [Security.AccessControl.FileSystemRights]::FullControl,$flags,$prop,$allow)
    $acl.AddAccessRule($rule)
  }
  if($workerWrite){
    $rule=New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($workerSid)),
      [Security.AccessControl.FileSystemRights]::Modify,$flags,$prop,$allow)
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $target -AclObject $acl
}
try {
  New-Item -ItemType Directory -Force -Path $secretDir,$workspace|Out-Null
  $dummy=Join-Path $secretDir 'runtime-key.dpapi'
  Set-Content -LiteralPath $dummy -Value 'CI_DUMMY_NOT_A_REAL_KEY' -Encoding ASCII
  RestrictDirectory $secretDir $false
  RestrictDirectory $workspace $true

  Add-Type -Path (Join-Path $repo 'src\worker\WindowsPipeAttestor.cs') -ErrorAction Stop
  if(-not [MiceHole.SecurityExperiment.WindowsPipeAttestor]::RejectSameUserClient()){
    throw 'Kernel Windows SID check failed to reject a same-user pipe client'
  }
  Write-Output 'WINDOWS_PIPE_SAME_USER_REJECTED=PASS'

  $proof=Join-Path $workspace 'worker-result.json'
  $marker=Join-Path $workspace 'task-did-work.txt'
  $workerScript=Join-Path $workspace 'worker-ci.ps1'
  $source=@'
$ErrorActionPreference='Stop'
$state=[ordered]@{worker_sid='';broker_credential_denied=$false;pipe_authenticated=$false;workspace_marker_written=$false;bounded_child_executed_as_worker=$false;error=''}
$pipe=$null
try {
  $state.worker_sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  try{[void](Get-Content -LiteralPath '__DUMMY__' -Raw -ErrorAction Stop)}
  catch [System.UnauthorizedAccessException]{$state.broker_credential_denied=$true}
  catch [System.IO.IOException]{$state.broker_credential_denied=$true}
  $pipe=New-Object System.IO.Pipes.NamedPipeClientStream(
      '.', '__PIPE_NAME__',
      [System.IO.Pipes.PipeDirection]::InOut,[System.IO.Pipes.PipeOptions]::None,
      [System.Security.Principal.TokenImpersonationLevel]::Impersonation)
  $pipe.Connect(7000)
  $pipe.WriteByte(17);$pipe.Flush()
  $grant=$pipe.ReadByte()
  if($grant -eq 1 -and $state.worker_sid -eq 'S-1-5-19'){
    $state.pipe_authenticated=$true
    Set-Content -LiteralPath '__MARKER__' -Value 'CI_WORKER_EXECUTED_ONLY_AFTER_BROKER_IDENTITY_APPROVAL' -Encoding ASCII
    $state.workspace_marker_written=$true
    # Fixed, harmless child command used only by disposable CI. This is not a generic shell API.
    $info=New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName=Join-Path $env:SystemRoot 'System32\whoami.exe'
    $info.Arguments='/user'
    $info.UseShellExecute=$false
    $info.RedirectStandardOutput=$true
    $info.CreateNoWindow=$true
    $child=[System.Diagnostics.Process]::Start($info)
    try {
      if(-not $child.WaitForExit(6000)){ $child.Kill();throw 'Fixed test child exceeded 6 second budget' }
      if($child.ExitCode -ne 0){throw ('Fixed child exited '+$child.ExitCode)}
      $out=$child.StandardOutput.ReadToEnd()
      if($out -notmatch 'S-1-5-19'){throw 'Child did not inherit the restricted Worker SID'}
      $state.bounded_child_executed_as_worker=$true
    }finally{$child.Dispose()}
    $pipe.WriteByte(35);$pipe.Flush()
  }else{$state.error='Broker rejected Worker or wrong execution identity'}
}catch{$state.error=$_.Exception.GetType().Name+': '+$_.Exception.Message}
finally {
  if($null -ne $pipe){$pipe.Dispose()}
  $state|ConvertTo-Json|Set-Content -LiteralPath '__PROOF__' -Encoding UTF8
}
'@
  $source=$source.Replace('__DUMMY__',$dummy.Replace("'","''"))
  $source=$source.Replace('__MARKER__',$marker.Replace("'","''"))
  $source=$source.Replace('__PROOF__',$proof.Replace("'","''"))
  $source=$source.Replace('__PIPE_NAME__',$pipeName)
  Set-Content -LiteralPath $workerScript -Value $source -Encoding UTF8

  $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$workerScript+'"')
  $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5)
  $principal=New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
  Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings|Out-Null
  $taskRegistered=$true
  $server=[MiceHole.SecurityExperiment.WindowsPipeAttestor]::Create($pipeName,$brokerSid,$workerSid)
  try {
    Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath
    $result=[MiceHole.SecurityExperiment.WindowsPipeAttestor]::AuthorizeOnce($server,$workerSid,13000)
  } finally { $server.Dispose() }

  for($i=0;$i -lt 30 -and -not(Test-Path -LiteralPath $proof);$i++){Start-Sleep -Milliseconds 350}
  if(-not(Test-Path -LiteralPath $proof)){throw 'LocalService Worker produced no report'}
  $w=Get-Content -LiteralPath $proof -Raw | ConvertFrom-Json
  if(-not $result.Authorized -or $result.ObservedSid -ne $workerSid){throw 'Broker failed actual Windows peer-SID authentication'}
  if(-not $result.WorkerAcknowledged){throw ('Worker did not acknowledge Broker approval; worker error: '+$w.error)}
  if($w.worker_sid -ne $workerSid){throw 'Task did not run as the expected Windows SID'}
  if(-not $w.broker_credential_denied){throw 'Worker accessed Broker dummy credential'}
  if(-not $w.pipe_authenticated -or -not $w.workspace_marker_written -or -not(Test-Path -LiteralPath $marker) -or -not $w.bounded_child_executed_as_worker){throw ('Worker did not perform fixed authorized child: '+$w.error)}
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportFile) | Out-Null
  [ordered]@{
    ok=$true;broker_and_worker_sids_distinct=$true
    pipe_dacl_specifies_only_broker_and_worker=$true
    observed_worker_sid_from_kernel=$workerSid
    same_user_client_rejected=$true
    dummy_broker_credential_denied=$true
    bounded_workspace_action_completed=$true
    fixed_child_executed_as_worker_sid=$true
    no_real_tunnel_or_owner_pc_mutated=$true
    production_worker_security_verified=$false
    caveat='CI-only LocalService is shared with other services; no production peer hardening, replay protection, job objects or command sandbox proven.'
  }|ConvertTo-Json|Set-Content -LiteralPath $reportFile -Encoding UTF8
  Write-Output 'WINDOWS_PIPE_DACL_AND_KERNEL_PEER_SID=PASS'
  Write-Output 'LOW_PRIVILEGE_WORKSPACE_ACTION=PASS'
  Write-Output 'FIXED_BOUNDED_CHILD_EXECUTION_UNDER_WORKER_SID=PASS'
  Write-Output 'BROKER_DUMMY_CREDENTIAL_ACL=PASS'
  Write-Output 'REMOTE_SHELL_STILL_LOCKED=PASS'
} finally {
  if($taskRegistered){Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false -ErrorAction SilentlyContinue}
  if(Test-Path -LiteralPath $qa){Remove-Item -LiteralPath $qa -Recurse -Force -ErrorAction SilentlyContinue}
}
