[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$iss=Get-Content -LiteralPath (Join-Path $root 'installer\micehole.iss') -Raw
if($iss -notmatch '(?m)^PrivilegesRequired=lowest\s*$'){throw 'Installer must run as current user'}
if($iss -notmatch '(?m)^AppId=\{\{06EF1EC2-BC39-49E8-9AE5-97978956A51E\}\s*$'){throw 'Unexpected app registration ID'}
$installPart=[regex]::Match($iss,'(?s)\[Run\](.*?)\[UninstallRun\]').Groups[1].Value
$removePart=[regex]::Match($iss,'(?s)\[UninstallRun\](.*)$').Groups[1].Value
if([string]::IsNullOrWhiteSpace($installPart) -or [string]::IsNullOrWhiteSpace($removePart)){throw 'Installer install/uninstall actions incomplete'}
if($installPart -match '(?i)remote-autostart\.ps1|MiceHole Personal Tunnel Supervisor|Register-ScheduledTask'){throw 'Installer must not silently enable remote background access'}
if($removePart -notmatch 'remote-autostart\.ps1'){throw 'Uninstaller does not remove the personal task'}
if($removePart -notmatch '\-Action Remove'){throw 'Uninstaller does not request task removal'}
if($iss -notmatch 'MiceHole Control'){throw 'Missing management UI shortcut'}
$stage=Join-Path $root 'dist\stage'
if(Test-Path -LiteralPath $stage){
  foreach($name in @('scripts\remote-supervisor.ps1','scripts\remote-autostart.ps1','scripts\quiet-launch.vbs')){
    if(-not(Test-Path -LiteralPath (Join-Path $stage $name))){throw "Missing packaged file: $name"}
  }
  $suspect=Get-ChildItem -LiteralPath $stage -File -Recurse|Where-Object {$_.Name -match '^(?:\.env.*|.*\.(?:key|pem|p12|pfx))$'}
  if($suspect){throw 'Sensitive file type unexpectedly packaged'}
}
Write-Output 'INSTALLER_CONTRACT=PASS'
Write-Output 'NO_AUTOSTART_WITHOUT_USER_CONSENT=PASS'
Write-Output 'UNINSTALL_REMOVES_PERSONAL_TASK=PASS'
