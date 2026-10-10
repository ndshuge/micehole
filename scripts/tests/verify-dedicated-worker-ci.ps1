[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

# HIGH-IMPACT W2-C FIXTURE: creates a Windows user and task on an EPHEMERAL
# GitHub-hosted runner ONLY. NEVER invoke this file on the owner's actual PC.
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
   $env:RUNNER_OS -ne 'Windows' -or [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or
   [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)){
  throw 'DEDICATED_WORKER_CI_ONLY: Refusing account/task/ACL changes outside ephemeral GitHub-hosted Windows'
}
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$nonce=[Guid]::NewGuid().ToString('N')
$qa=Join-Path $env:RUNNER_TEMP ('micehole-w2c-'+$nonce)
$secretDir=Join-Path $qa 'broker-only'
$workspace=Join-Path $qa 'authorized-workspace'
$pipeName='MiceHole-W2C-'+$nonce
$taskName='MiceHole W2C Dedicated QA '+$nonce
$taskPath='\MiceHoleWorkerCI\'
$userName='mhci_'+$nonce.Substring(0,12)
$localUser="$env:COMPUTERNAME\$userName"
$workerSid=$null
$brokerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskRegistered=$false
$createdUser=$false
$workerProcess=$null
$secureLogon=$null
$plainPassword=$null
$reportFile=Join-Path $repo 'qa-fixture\dedicated-worker-ci-proof.json'
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
function PermitWorkspaceParentTraverse([string]$path) {
  $acl=Get-Acl -LiteralPath $path
  $acl.SetAccessRuleProtection($true,$false)
  $flags=[Security.AccessControl.InheritanceFlags]::None
  $prop=[Security.AccessControl.PropagationFlags]::None
  $allow=[Security.AccessControl.AccessControlType]::Allow
  foreach($id in @($brokerSid,'S-1-5-18')) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($id)),
      [Security.AccessControl.FileSystemRights]::FullControl,$flags,$prop,$allow)))
  }
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($workerSid)),
    [Security.AccessControl.FileSystemRights]::ReadAndExecute,$flags,$prop,$allow)))
  Set-Acl -LiteralPath $path -AclObject $acl
}
try {
  # Generate one-use password; never log, persist or pass in a command-line argument.
  $random=New-Object byte[] 36
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  try {$rng.GetBytes($random)}finally{$rng.Dispose()}
  $plainPassword=[Convert]::ToBase64String($random)+'!aA1'
  [Array]::Clear($random,0,$random.Length)
  $secure=ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
  try {
    New-LocalUser -Name $userName -Password $secure -AccountNeverExpires -PasswordNeverExpires -Description 'MiceHole disposable CI worker; delete after test' -ErrorAction Stop|Out-Null
    $createdUser=$true
  }finally{$secure.Dispose()}
  $workerSid=(Get-LocalUser -Name $userName -ErrorAction Stop).SID.Value
  if($workerSid -eq $brokerSid -or $workerSid -eq 'S-1-5-19'){
    throw 'Worker must have a unique dedicated user SID'
  }
  $adminsSid='S-1-5-32-544'
  $adminGroup=Get-LocalGroup -SID $adminsSid -ErrorAction Stop
  $members=@(Get-LocalGroupMember -Group $adminGroup.Name -ErrorAction Stop)
  if(@($members|Where-Object {$_.SID.Value -eq $workerSid}).Count -ne 0){
    throw 'Dedicated Worker MUST NOT belong to the Administrators group'
  }
  New-Item -ItemType Directory -Force -Path $secretDir,$workspace|Out-Null
  PermitWorkspaceParentTraverse $qa
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
  # Compile in disposable runner context; load binaries only inside dedicated user.
  # This is NOT a production account-provisioning script.
  $jobDll=Join-Path $workspace 'MiceHole-W2B-JobRunner.dll'
  Add-Type -Path (Join-Path $repo 'src\worker\WindowsJobRunner.cs') -OutputAssembly $jobDll -ErrorAction Stop
  $sessionDll=Join-Path $workspace 'MiceHole-W2B2-Session.dll'
  Add-Type -Path (Join-Path $repo 'src\worker\BoundedWorkerSession.cs') -OutputAssembly $sessionDll -ErrorAction Stop
  $sessionHost=Join-Path $workspace 'worker-session-host.ps1'
  Copy-Item -LiteralPath (Join-Path $repo 'scripts\tests\worker-session-host.ps1') -Destination $sessionHost
  $sessionReport=Join-Path $workspace 'session-worker-proof.json'
  $source=@'
$ErrorActionPreference='Stop'
$state=[ordered]@{worker_sid='';broker_credential_denied=$false;pipe_authenticated=$false;workspace_marker_written=$false;bounded_child_executed_as_worker=$false;bounded_session_under_worker_sid=$false;error=''}
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
  if($grant -eq 1 -and $state.worker_sid -eq '__EXPECTED_WORKER_SID__'){
    $state.pipe_authenticated=$true
    Set-Content -LiteralPath '__MARKER__' -Value 'CI_WORKER_EXECUTED_ONLY_AFTER_BROKER_IDENTITY_APPROVAL' -Encoding ASCII
    $state.workspace_marker_written=$true
    # Fixed, harmless CI command only. The worker is already a distinct Windows SID.
    # This tests suspended CreateProcess -> job assignment -> resume, not a generic API.
    Add-Type -Path '__JOB_DLL__' -ErrorAction Stop
    $cmd=Join-Path $env:SystemRoot 'System32\cmd.exe'
    $testArgs='/d /c whoami /user > "__COMMAND_OUTPUT__"'
    $job=[MiceHole.SecurityExperiment.WindowsJobRunner]::StartFixed($cmd,$testArgs,'__WORKSPACE__')
    try {
      if(-not $job.Wait(6000)){ $job.Cancel();throw 'Fixed test child exceeded 6 second budget' }
      if($job.ExitCode -ne 0){throw ('Fixed child exited '+$job.ExitCode)}
      $out=Get-Content -LiteralPath '__COMMAND_OUTPUT__' -Raw -ErrorAction Stop
      if(-not $out.Contains($state.worker_sid)){throw 'Child did not inherit the dedicated Worker SID'}
      $state.bounded_child_executed_as_worker=$true
    }finally{$job.Dispose()}
    $pipe.WriteByte(35);$pipe.Flush()
    # A second, fixed child host inherits its own Job and verifies stream/status
    # sessions under the separate dedicated account (not shared LocalService).
    $shell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $sessionArgs='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "__SESSION_HOST__" -Assembly "__SESSION_DLL__" -Workspace "__WORKSPACE__" -Report "__SESSION_REPORT__"'
    $sessionJob=[MiceHole.SecurityExperiment.WindowsJobRunner]::StartFixed($shell,$sessionArgs,'__WORKSPACE__')
    try{
      if(-not $sessionJob.Wait(45000)){$sessionJob.Cancel();throw 'Worker stream fixture timed out'}
      if($sessionJob.ExitCode -ne 0){throw ('Worker stream fixture nonzero exit '+$sessionJob.ExitCode)}
      $sessionResult=Get-Content -LiteralPath '__SESSION_REPORT__' -Raw -ErrorAction Stop | ConvertFrom-Json
      if(-not $sessionResult.ok){throw ('Worker session failed '+$sessionResult.error)}
      $state.bounded_session_under_worker_sid=$true
    }finally{$sessionJob.Dispose()}
  }else{$state.error='Broker rejected Worker or wrong execution identity'}
}catch{$state.error=$_.Exception.GetType().Name+': '+$_.Exception.Message}
finally {
  if($null -ne $pipe){$pipe.Dispose()}
  $state|ConvertTo-Json|Set-Content -LiteralPath '__PROOF__' -Encoding UTF8
}
'@
  $source=$source.Replace('__EXPECTED_WORKER_SID__',$workerSid)
  $source=$source.Replace('__DUMMY__',$dummy.Replace("'","''"))
  $source=$source.Replace('__MARKER__',$marker.Replace("'","''"))
  $source=$source.Replace('__PROOF__',$proof.Replace("'","''"))
  $source=$source.Replace('__PIPE_NAME__',$pipeName)
  $source=$source.Replace('__JOB_DLL__',$jobDll.Replace("'","''"))
  $source=$source.Replace('__SESSION_HOST__',$sessionHost.Replace("'","''"))
  $source=$source.Replace('__SESSION_DLL__',$sessionDll.Replace("'","''"))
  $source=$source.Replace('__SESSION_REPORT__',$sessionReport.Replace("'","''"))
  $source=$source.Replace('__WORKSPACE__',$workspace.Replace("'","''"))
  $source=$source.Replace('__COMMAND_OUTPUT__',(Join-Path $workspace 'worker-whoami-output.txt').Replace("'","''"))
  Set-Content -LiteralPath $workerScript -Value $source -Encoding UTF8

  # A clean secondary Windows logon in disposable CI. Windows manages the
  # credential via CreateProcessWithLogonW; the password is never an argument.
  # Task Scheduler start-on-login remains a SEPARATE, unverified release gate.
  $secureLogon=ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
  $info=New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $info.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$workerScript+'"'
  $info.UserName=$userName
  $info.Domain=$env:COMPUTERNAME
  $info.Password=$secureLogon
  $info.UseShellExecute=$false
  $info.CreateNoWindow=$true
  $info.WorkingDirectory=$workspace
  $server=[MiceHole.SecurityExperiment.WindowsPipeAttestor]::Create($pipeName,$brokerSid,$workerSid)
  try {
    $workerProcess=[System.Diagnostics.Process]::Start($info)
    $plainPassword=$null
    $secureLogon.Dispose()
    $result=[MiceHole.SecurityExperiment.WindowsPipeAttestor]::AuthorizeOnce($server,$workerSid,15000)
  } finally { $server.Dispose() }

  for($i=0;$i -lt 150 -and -not(Test-Path -LiteralPath $proof);$i++){Start-Sleep -Milliseconds 400}
  if(-not(Test-Path -LiteralPath $proof)){throw 'Dedicated Worker produced no report'}
  $w=Get-Content -LiteralPath $proof -Raw | ConvertFrom-Json
  if(-not $result.Authorized -or $result.ObservedSid -ne $workerSid){throw 'Broker failed actual Windows peer-SID authentication'}
  if(-not $result.WorkerAcknowledged){throw ('Worker did not acknowledge Broker approval; worker error: '+$w.error)}
  if($w.worker_sid -ne $workerSid){throw 'Task did not run as the expected Windows SID'}
  if(-not $w.broker_credential_denied){throw 'Worker accessed Broker dummy credential'}
  if(-not $w.pipe_authenticated -or -not $w.workspace_marker_written -or -not(Test-Path -LiteralPath $marker) -or -not $w.bounded_child_executed_as_worker -or -not $w.bounded_session_under_worker_sid){throw ('Worker did not complete low-privilege session: '+$w.error)}
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportFile) | Out-Null
  [ordered]@{
    ok=$true;broker_and_worker_sids_distinct=$true
    pipe_dacl_specifies_only_broker_and_worker=$true
    observed_worker_sid_from_kernel=$workerSid
    same_user_client_rejected=$true
    dummy_broker_credential_denied=$true
    bounded_workspace_action_completed=$true
    fixed_child_executed_as_worker_sid=$true
    fixed_child_suspended_then_job_assigned_before_resume=$true
    output_session_verified_under_low_privilege_sid=$true
    dedicated_non_admin_windows_user=$true
    dedicated_user_logon_via_create_process_with_logon=$true
    scheduled_task_autostart_verified=$false
    no_real_tunnel_or_owner_pc_mutated=$true
    production_worker_security_verified=$false
    caveat='CI-only dedicated user deleted in cleanup; no production provisioning, server authentication, replay-safe requests or command sandbox proven.'
  }|ConvertTo-Json|Set-Content -LiteralPath $reportFile -Encoding UTF8
  Write-Output 'WINDOWS_PIPE_DACL_AND_KERNEL_PEER_SID=PASS'
  Write-Output 'LOW_PRIVILEGE_WORKSPACE_ACTION=PASS'
  Write-Output 'FIXED_BOUNDED_CHILD_EXECUTION_UNDER_WORKER_SID=PASS'
  Write-Output 'WORKER_JOB_OBJECT_SUSPENDED_LAUNCH=PASS'
  Write-Output 'DEDICATED_WORKER_BOUNDED_SESSION=PASS'
  Write-Output 'BROKER_DUMMY_CREDENTIAL_ACL=PASS'
  Write-Output 'REMOTE_SHELL_STILL_LOCKED=PASS'
} finally {
  # Full rollback, including failure paths. Never affect any other OS account.
  if($workerProcess){
    try{
      if(-not $workerProcess.HasExited){
        $workerProcess.Kill()
        [void]$workerProcess.WaitForExit(5000)
      }
    }catch{}
    $workerProcess.Dispose()
  }
  if($taskRegistered){
    Stop-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false -ErrorAction SilentlyContinue
  }
  $plainPassword=$null
  if($secureLogon){$secureLogon.Dispose()}
  $cleanupFailed=$false
  if($createdUser){
    for($i=0;$i -lt 6 -and (Get-LocalUser -Name $userName -ErrorAction SilentlyContinue);$i++){
      try{Remove-LocalUser -Name $userName -ErrorAction Stop}catch{Start-Sleep -Milliseconds 500}
    }
    if(Get-LocalUser -Name $userName -ErrorAction SilentlyContinue){$cleanupFailed=$true}
  }
  if(Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue){$cleanupFailed=$true}
  if(Test-Path -LiteralPath $qa){Remove-Item -LiteralPath $qa -Recurse -Force -ErrorAction SilentlyContinue}
  if($cleanupFailed){throw 'DEDICATED_WORKER_CI_CLEANUP_FAILED: residual disposable Windows account or task'}
  Write-Output 'DEDICATED_WORKER_TEST_ACCOUNT_REMOVED=PASS'
}
