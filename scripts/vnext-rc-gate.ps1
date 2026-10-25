param(
  [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) '_release_candidate')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path -Parent $PSScriptRoot
$checks = [ordered]@{}
$node = (Get-Command node.exe -ErrorAction Stop).Source
$oldLocalAppData = $env:LOCALAPPDATA
$oldWorkspace = $env:MOUSE_HOLE_WORKSPACE
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('micehole-rc-gate-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
  foreach($file in @('mouse-hole-server.mjs','mouse-hole-core.mjs','browser-runtime-policy.mjs','gui-background-policy.mjs')) {
    & $node --check (Join-Path $repo "direct/mcp/remote/$file")
    if($LASTEXITCODE -ne 0){throw "Syntax failed: $file"}
  }
  $checks['syntax'] = 'PASS'
  foreach($test in @('test-direct-port.mjs','test-md-habit.mjs','test-remote-high-privilege.mjs')) {
    & $node (Join-Path $repo "scripts/$test")
    if($LASTEXITCODE -ne 0){throw "Test failed: $test"}
  }
  $checks['functional_tests'] = 'PASS'
  & (Join-Path $repo 'scripts/build-direct-port.ps1') -OutputDirectory $OutputDirectory
  if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw 'Build failed'}
  $zip = Join-Path $OutputDirectory 'MiceHole-Direct-vNext-0.2.1-RC-Portable.zip'
  $checksumFile = Join-Path $OutputDirectory 'MiceHole-Direct-vNext-0.2.1-RC-SHA256SUMS.txt'
  if(!(Test-Path $zip) -or !(Test-Path $checksumFile)){throw 'Package or SHA manifest missing'}
  $digest = (Get-FileHash $zip -Algorithm SHA256).Hash.ToUpperInvariant()
  $manifestDigest = ((Get-Content $checksumFile -Raw).Trim().Split(' ')[0]).ToUpperInvariant()
  if($digest -ne $manifestDigest){throw 'SHA256 mismatch'}
  $checks['sha256'] = 'PASS'
  $unpacked = Join-Path $tempRoot 'unpacked'
  Expand-Archive -LiteralPath $zip -DestinationPath $unpacked -Force
  $workspace = Join-Path $tempRoot 'workspace'
  $env:LOCALAPPDATA = Join-Path $tempRoot 'appdata'
  New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force | Out-Null
  $env:MOUSE_HOLE_WORKSPACE = $workspace
  & powershell.exe -NoProfile -File (Join-Path $unpacked 'setup-friend.ps1') -Workspace $workspace
  if($LASTEXITCODE -ne 0){throw 'Unpacked friend setup failed'}
  $doctor = & powershell.exe -NoProfile -File (Join-Path $unpacked 'scripts/friend-doctor.ps1') | Out-String | ConvertFrom-Json
  if($LASTEXITCODE -ne 0 -or !$doctor.local_ready -or $doctor.tools_count -ne 15 -or $doctor.remote_high_privilege_verified){throw 'Unpacked Doctor gate failed'}
  $checks['unpacked_install'] = 'PASS'
  $entries = @(& tar.exe -tf $zip)
  $bad = @($entries | Where-Object {$_ -match '(^|/)(\.env|\.git|__pycache__|secrets|credentials)(/|$)|\.(key|pem|pfx|p12)$'})
  if($bad.Count -ne 0){throw 'Sensitive archive paths detected'}
  $checks['archive_path_audit'] = 'PASS'
  $result = [ordered]@{
    candidate='v0.2.1-rc.1'
    verified=$true
    tests=$checks
    zip=$zip
    sha256=$digest
    entries=$entries.Count
    public_remote_high_privilege_approved=$false
    warnings=@('Only developer-machine disposable testing','Credential isolation and remote end-to-end not verified','Not approved for public high privilege use')
  }
  $result | ConvertTo-Json -Depth 6
} finally {
  $env:LOCALAPPDATA = $oldLocalAppData
  $env:MOUSE_HOLE_WORKSPACE = $oldWorkspace
  Remove-Item -LiteralPath $tempRoot -Force -Recurse -ErrorAction SilentlyContinue
}
