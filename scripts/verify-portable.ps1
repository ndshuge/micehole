[CmdletBinding()]
param([string]$Archive='')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=Split-Path -Parent $PSScriptRoot
if([string]::IsNullOrWhiteSpace($Archive)){
  $Archive=Join-Path $root 'dist\MiceHole-Universal-0.1.0-Windows-x64.zip'
}
$archivePath=(Resolve-Path -LiteralPath $Archive -ErrorAction Stop).ProviderPath
$temp=Join-Path ([IO.Path]::GetTempPath()) ('MiceHole-Portable-Check-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temp | Out-Null
$oldConfig=[Environment]::GetEnvironmentVariable('MICEHOLE_CONFIG','Process')
try {
  $distribution=Join-Path $temp 'app'
  Expand-Archive -LiteralPath $archivePath -DestinationPath $distribution -Force
  foreach($file in @('micehole.cmd','micehole-remote.cmd','runtime\node.exe','src\server.mjs','scripts\remote-setup.ps1','scripts\remote-doctor.ps1','scripts\remote-control.ps1','scripts\remote-supervisor.ps1','scripts\remote-autostart.ps1','scripts\quiet-launch.vbs','tunnel-client\tunnel-client.exe','tunnel-client\LICENSE','tunnel-client\NOTICE','LICENSE')){
    if(-not(Test-Path -LiteralPath (Join-Path $distribution $file) -PathType Leaf)) {throw ('Missing packaged file: '+$file)}
  }
  foreach($prototype in @('src\transfer-prototype.mjs','src\transfer-prototype.test.mjs','docs\ATTACHMENT_TRANSFER_DESIGN.md')){
    if(Test-Path -LiteralPath (Join-Path $distribution $prototype)){throw ('Unapproved prototype file shipped in distribution: '+$prototype)}
  }
  $workspace=Join-Path $temp 'workspace'
  New-Item -ItemType Directory -Force -Path $workspace | Out-Null
  $cfg=Join-Path $temp 'config.json'
  @{workspace=$workspace;executionEnabled=$false} | ConvertTo-Json | Set-Content -LiteralPath $cfg -Encoding UTF8
  $env:MICEHOLE_CONFIG=$cfg
  $node=Join-Path $distribution 'runtime\node.exe'
  $server=Join-Path $distribution 'src\server.mjs'
  $doctor=& $node $server --doctor | ConvertFrom-Json
  if(-not $doctor.ready -or $doctor.executionEnabled){throw 'Packaged doctor failed safe-default check.'}
  & $node (Join-Path $PSScriptRoot 'portable-smoke.mjs') $distribution
  if($LASTEXITCODE -ne 0){throw 'Packaged MCP behavioral test failed.'}
  & $node (Join-Path $PSScriptRoot 'remote-safe-test.mjs') $distribution
  if($LASTEXITCODE -ne 0){throw 'Packaged remote-safe MCP guard test failed.'}
  Write-Output 'PORTABLE_RELEASE_VERIFY=PASS'
}finally {
  if($null -eq $oldConfig){Remove-Item Env:MICEHOLE_CONFIG -ErrorAction SilentlyContinue}
  else{$env:MICEHOLE_CONFIG=$oldConfig}
  Remove-Item -LiteralPath $temp -Force -Recurse -ErrorAction SilentlyContinue
}
