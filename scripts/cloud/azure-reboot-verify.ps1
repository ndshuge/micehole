$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Join-Path $env:ProgramData 'MiceHoleRebootQA'
$taskName = 'MiceHole Reboot QA Marker'
$taskPath = '\MiceHoleQA\'
$beforeFile = Join-Path $root 'boot-before.txt'
$startupFile = Join-Path $root 'startup-boot.txt'
if(-not(Test-Path -LiteralPath $beforeFile -PathType Leaf)){throw 'Pre-reboot marker missing'}
if(-not(Test-Path -LiteralPath $startupFile -PathType Leaf)){throw 'Startup scheduled task did not run after reboot'}
$before = [DateTime]::Parse((Get-Content -LiteralPath $beforeFile -Raw).Trim()).ToUniversalTime()
$after = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime()
$startup = [DateTime]::Parse((Get-Content -LiteralPath $startupFile -Raw).Trim()).ToUniversalTime()
if($after -le $before){throw 'Boot timestamp unchanged: actual reboot has not been proven'}
if([Math]::Abs(($startup - $after).TotalSeconds) -gt 120){throw 'Boot marker does not match current boot'}
$task = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction Stop
if($null -eq $task){throw 'Test startup task not found'}
Write-Output 'MICEHOLE_AZURE_REBOOT_VERIFIED=PASS'
Write-Output 'MICEHOLE_STARTUP_TRIGGER=PASS'
Write-Output ('MICEHOLE_BOOT_BEFORE='+$before.ToString('o'))
Write-Output ('MICEHOLE_BOOT_AFTER='+$after.ToString('o'))
