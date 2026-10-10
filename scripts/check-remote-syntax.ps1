$ErrorActionPreference='Stop'
$base=$PSScriptRoot
$files=@('remote-setup.ps1','remote-save-key.ps1','remote-doctor.ps1','remote-run.ps1','remote-control.ps1','remote-supervisor.ps1','remote-autostart.ps1','tests\verify-supervisor.ps1','fetch-tunnel-client.ps1','verify-portable.ps1','verify-tunnel-onboarding.ps1','verify-installer-contract.ps1','tests\verify-installer-lifecycle.ps1')
$allOk=$true
foreach($name in $files){
  $tokens=$null;$parseErrors=$null
  $null=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $base $name),[ref]$tokens,[ref]$parseErrors)
  if($parseErrors.Count -gt 0){$allOk=$false;Write-Output ("FAIL "+$name+" "+($parseErrors|Select-Object -First 1 -ExpandProperty Message))}
  else{Write-Output ("PASS "+$name)}
}
if(-not $allOk){exit 1}
