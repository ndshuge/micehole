$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Join-Path $env:ProgramData 'MiceHoleRebootQA'
$taskName = 'MiceHole Reboot QA Marker'
$taskPath = '\MiceHoleQA\'
$task = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
if($null -ne $task) {
  Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false
}
if(Test-Path -LiteralPath $root -PathType Container){
  Remove-Item -LiteralPath $root -Recurse -Force
}
Write-Output 'MICEHOLE_AZURE_REBOOT_QA_CLEANUP=PASS'
