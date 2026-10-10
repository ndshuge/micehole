[CmdletBinding()]
param(
  [string]$SetupFile = '',
  [switch]$KeepEvidence,
  [switch]$PlanOnly
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if(-not $SetupFile){$SetupFile=Join-Path $repo 'dist\installer\MiceHole-Universal-0.1.0-Setup.exe'}
$setup=(Resolve-Path -LiteralPath $SetupFile -ErrorAction Stop).ProviderPath
$id='06EF1EC2-BC39-49E8-9AE5-97978956A51E'
$regKeys=@(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
function Get-Registered {
  $found=@()
  foreach($regKey in $regKeys){
    if(-not(Test-Path $regKey)){continue}
    foreach($child in @(Get-ChildItem -LiteralPath $regKey -ErrorAction SilentlyContinue)){
      $row=Get-ItemProperty -LiteralPath $child.PSPath -ErrorAction SilentlyContinue
      $display = if($null -ne $row -and $null -ne $row.PSObject.Properties['DisplayName']){[string]$row.PSObject.Properties['DisplayName'].Value}else{''}
      if($null -ne $row -and (($child.PSChildName -like ('*'+$id+'*')) -or ($display -like 'MiceHole Universal*'))){
        $found+=($row.PSPath)
      }
    }
  }
  return @($found)
}
function Get-PersonalTask {
  return Get-ScheduledTask -TaskName 'MiceHole Personal Tunnel Supervisor' -TaskPath '\MiceHole\' -ErrorAction SilentlyContinue
}
if(@(Get-Registered).Count -gt 0){throw 'Pre-existing MiceHole Universal product registration; refusing installer test to protect the installed app.'}
if($null -ne (Get-PersonalTask)){throw 'A MiceHole Personal Tunnel Supervisor task already exists; refusing installer test.'}
if($PlanOnly){Write-Output 'INSTALLER_LIFECYCLE_PREFLIGHT=PASS_NO_MUTATION';return}
$temp=Join-Path ([IO.Path]::GetTempPath()) ('micehole-install-gate-'+[guid]::NewGuid().ToString('N'))
$install=Join-Path $temp 'installed'
$qaRoot=Join-Path $temp 'fake-user'
$setupLog=Join-Path $temp 'setup.log'
$uninstallLog=Join-Path $temp 'uninstall.log'
New-Item -ItemType Directory -Force -Path $temp,$qaRoot | Out-Null
$oldQa=[Environment]::GetEnvironmentVariable('MICEHOLE_INSTALL_TEST_ROOT','Process')
$oldLocal=[Environment]::GetEnvironmentVariable('LOCALAPPDATA','Process')
$oldProfile=[Environment]::GetEnvironmentVariable('USERPROFILE','Process')
$installed=$false
$uninstalled=$false
$cleanupError=$null
$report=[ordered]@{
  started_utc=[DateTime]::UtcNow.ToString('o')
  scope='current-user isolated QA path'
  setup_sha256=(Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash
  used_real_tunnel=$false
  restart_requested=$false
  created_system_user=$false
  setup_exit=$null
  uninstall_exit=$null
  bootstrap_redirected=$false
  launcher_present=$false
  no_product_registration_after=$false
  no_public_task_after=$false
  qa_path=$temp
  verdict='INCOMPLETE'
}
try {
  # Setup runs under a uniquely redirected user profile. No secrets or real Tunnel are supplied.
  $env:MICEHOLE_INSTALL_TEST_ROOT=$qaRoot
  $env:LOCALAPPDATA=Join-Path $qaRoot 'LocalAppData'
  $env:USERPROFILE=Join-Path $qaRoot 'UserProfile'
  New-Item -ItemType Directory -Path $env:LOCALAPPDATA,$env:USERPROFILE -Force|Out-Null
  $arguments='/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="'+$install+'" /LOG="'+$setupLog+'"'
  $p=Start-Process -FilePath $setup -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden
  $report.setup_exit=$p.ExitCode
  if($p.ExitCode -ne 0){throw ('Inno Setup failed with '+$p.ExitCode)}
  $installed=$true
  foreach($file in @('micehole.cmd','micehole-remote.cmd','runtime\node.exe','src\server.mjs','scripts\remote-control.ps1','tunnel-client\tunnel-client.exe')){
    if(-not(Test-Path -LiteralPath (Join-Path $install $file) -PathType Leaf)){throw ('Missing installed asset: '+$file)}
  }
  $report.launcher_present=$true
  $cfg=Join-Path $qaRoot 'LocalAppData\MiceHole\config.json'
  if(-not(Test-Path -LiteralPath $cfg -PathType Leaf)){throw 'Installer bootstrap did not create isolated QA configuration'}
  $cfgObject=Get-Content -LiteralPath $cfg -Raw|ConvertFrom-Json
  if($cfgObject.executionEnabled){throw 'Fresh install unexpectedly enabled arbitrary command execution'}
  if($cfgObject.workspace -ne (Join-Path $qaRoot 'Workspace')){throw 'Fresh install workspace not isolated'}
  $report.bootstrap_redirected=$true
  if($null -ne (Get-PersonalTask)){throw 'Installer silently created an autostart task'}
  $uninstaller=Join-Path $install 'unins000.exe'
  if(-not(Test-Path -LiteralPath $uninstaller -PathType Leaf)){throw 'Missing Inno uninstaller'}
  $args2='/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="'+$uninstallLog+'"'
  $q=Start-Process -FilePath $uninstaller -ArgumentList $args2 -PassThru -Wait -WindowStyle Hidden
  $report.uninstall_exit=$q.ExitCode
  if($q.ExitCode -ne 0){throw ('Uninstaller failed with '+$q.ExitCode)}
  $uninstalled=$true
  # Allow a short delay for the uninstall cleanup process to finish.
  Start-Sleep -Milliseconds 350
  if(@(Get-Registered).Count -gt 0){throw 'Inno product registry entries remain after uninstall'}
  $report.no_product_registration_after=$true
  if($null -ne (Get-PersonalTask)){throw 'Public personal task remains after uninstall'}
  $report.no_public_task_after=$true
  if(Test-Path -LiteralPath (Join-Path $install 'micehole.cmd')){throw 'Installed executable remains after uninstall'}
  $report.verdict='PASS'
  Write-Output 'INSTALL_LIFECYCLE_CURRENT_USER=PASS'
  Write-Output 'INSTALL_BOOTSTRAP_ISOLATED=PASS'
  Write-Output 'NO_SYSTEM_REBOOT_OR_ACCOUNT_CHANGES=PASS'
  Write-Output 'UNINSTALL_CLEANUP=PASS'
}catch{
  $report.verdict='FAIL'
  $report.error=$_.Exception.Message
  throw
}finally{
  # Cleanup only the QA-owned installation. Never kill or remove production tasks.
  if($installed -and -not $uninstalled){
    $uninstaller=Join-Path $install 'unins000.exe'
    if(Test-Path -LiteralPath $uninstaller){
      try{& $uninstaller '/VERYSILENT' '/SUPPRESSMSGBOXES' '/NORESTART' | Out-Null}catch{$cleanupError=$_.Exception.Message}
    }
  }
  if($null -eq $oldQa){Remove-Item Env:MICEHOLE_INSTALL_TEST_ROOT -ErrorAction SilentlyContinue}else{$env:MICEHOLE_INSTALL_TEST_ROOT=$oldQa}
  if($null -eq $oldLocal){Remove-Item Env:LOCALAPPDATA -ErrorAction SilentlyContinue}else{$env:LOCALAPPDATA=$oldLocal}
  if($null -eq $oldProfile){Remove-Item Env:USERPROFILE -ErrorAction SilentlyContinue}else{$env:USERPROFILE=$oldProfile}
  $evidenceDir=Join-Path $repo 'qa-fixture'
  New-Item -ItemType Directory -Force -Path $evidenceDir|Out-Null
  $report.finished_utc=[DateTime]::UtcNow.ToString('o')
  if($cleanupError){$report.cleanup_error=$cleanupError}
  $report|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $evidenceDir 'pre-reboot-install-lifecycle.json') -Encoding UTF8
  if($report.verdict -eq 'PASS' -and -not $KeepEvidence){Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue}
  else{Write-Output ('QA_EVIDENCE_DIR='+$temp)}
}