$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Script is invoked only inside a disposable Windows VM selected through Azure tag guards.
# No MiceHole production secrets or private GitHub access are needed.
$root = Join-Path $env:ProgramData 'MiceHoleRebootQA'
$taskName = 'MiceHole Reboot QA Marker'
$taskPath = '\MiceHoleQA\'
if(Test-Path -LiteralPath $root) { throw 'Existing QA directory; refusing to overwrite without manual review.' }
if(Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue) {
  throw 'Existing QA startup task; refusing to overwrite.'
}
New-Item -ItemType Directory -Path $root -Force | Out-Null
try {
  $before = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
  Set-Content -LiteralPath (Join-Path $root 'boot-before.txt') -Value $before -Encoding ASCII
  $startupScript = @'
$ErrorActionPreference = "Stop"
$qaRoot = Join-Path $env:ProgramData "MiceHoleRebootQA"
if(-not(Test-Path -LiteralPath $qaRoot)){ exit 3 }
$timestamp = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString("o")
Set-Content -LiteralPath (Join-Path $qaRoot "startup-boot.txt") -Value $timestamp -Encoding ASCII
'@
  $startup = Join-Path $root 'startup-marker.ps1'
  Set-Content -LiteralPath $startup -Value $startupScript -Encoding UTF8
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$startup+'"')
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
  Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Disposable boot marker for Azure VM reboot verification' | Out-Null
  Write-Output "MICEHOLE_AZURE_PREPARED=PASS"
  Write-Output ("MICEHOLE_BOOT_BEFORE="+$before)
} catch {
  try{Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false -ErrorAction SilentlyContinue}catch{}
  throw
}
