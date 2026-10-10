param([string]$Compiler="",[switch]$ZipOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root 'dist\stage'
$dist = Join-Path $root 'dist'
if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
New-Item -ItemType Directory -Force -Path $stage,(Join-Path $stage 'runtime'),(Join-Path $stage 'src'),(Join-Path $stage 'scripts'),(Join-Path $stage 'docs') | Out-Null
foreach($file in @('core.mjs','server.mjs')){
  Copy-Item (Join-Path $root ('src\'+$file)) (Join-Path $stage 'src')
}
Copy-Item (Join-Path $root 'scripts\doctor.cmd') (Join-Path $stage 'scripts\doctor.cmd')
foreach($file in @('setup-config.ps1','enable-execution.ps1','disable-execution.ps1','remote-setup.ps1','remote-save-key.ps1','remote-doctor.ps1','remote-run.ps1','remote-control.ps1','remote-supervisor.ps1','remote-autostart.ps1','quiet-launch.vbs')){
  Copy-Item (Join-Path $root ('scripts\'+$file)) (Join-Path $stage ('scripts\'+$file))
}
Copy-Item (Join-Path $root 'scripts\micehole.cmd') (Join-Path $stage 'micehole.cmd')
Copy-Item (Join-Path $root 'scripts\micehole-remote.cmd') (Join-Path $stage 'micehole-remote.cmd')
# tunnel-client is not redistributed; each user selects an official binary during setup.
# Ship only documented, reviewed release assets; concurrent prototypes stay out of EXE/ZIP.
foreach($file in @('CHATGPT-QUICKSTART.md','CONNECT.md','INSTALL.md','PLUGIN-LISTING.md','README.en.md','README.zh-CN.md','RELEASE.md','RELEASE_NOTES_v0.1.0.md','SECURITY.md','SELF-HOSTED.md','WORKER_ISOLATION.md','PRE_REBOOT_GATE.md','CLOUD_REBOOT.md','PRODUCT_SCOPE.md')){
  Copy-Item (Join-Path $root ('docs\'+$file)) (Join-Path $stage 'docs')
}
Copy-Item (Join-Path $root 'README.md') (Join-Path $stage 'README.md')
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $stage 'LICENSE')
$vendorRoot = Join-Path $root 'build-tools\vendor\tunnel'
$vendorZip = Join-Path $vendorRoot 'tunnel-client-v0.0.15-windows-amd64.zip'
$vendorExpanded = Join-Path $vendorRoot 'expanded'
$vendorChecksum = '3B53133A1E24D43F63088D843860CB1701A4C3ED6390DE2E19F69089E43BDDC1'
if(-not(Test-Path -LiteralPath $vendorZip)){throw 'Official tunnel-client missing; run scripts/fetch-tunnel-client.ps1 first.'}
if((Get-FileHash -LiteralPath $vendorZip -Algorithm SHA256).Hash.ToUpperInvariant() -cne $vendorChecksum){throw 'Official tunnel-client SHA256 mismatch; refusing to package'}
foreach($required in @('tunnel-client.exe','LICENSE','NOTICE','tunnel-client-v0.0.15-windows-amd64-licenses.txt')){
  if(-not(Test-Path -LiteralPath (Join-Path $vendorExpanded $required) -PathType Leaf)){throw ('Missing tunnel-client distribution file: '+$required)}
}
$vendorStage=Join-Path $stage 'tunnel-client'
New-Item -ItemType Directory -Force -Path $vendorStage | Out-Null
Copy-Item -Path (Join-Path $vendorExpanded '*') -Destination $vendorStage -Recurse -Force
Write-Output 'TUNNEL_CLIENT_BUNDLED=v0.0.15 (official SHA256 verified, with licenses)'
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$node = if($nodeCommand){$nodeCommand.Source}else{'C:\Program Files\nodejs\node.exe'}
if(!(Test-Path -LiteralPath $node)){ throw "Node.js executable missing at $node" }
$arch = & $node -p 'process.arch'
if($arch.Trim() -ne 'x64'){throw 'Only Windows x64 bundled Node runtimes are supported by this installer.'}
Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'runtime\node.exe')
$license = Join-Path $root 'installer\NODE-LICENSE.txt'
if(!(Test-Path -LiteralPath $license)){ throw "Node license missing" }
Copy-Item -LiteralPath $license -Destination (Join-Path $stage 'runtime\NODE-LICENSE.txt')
$zip = Join-Path $dist 'MiceHole-Universal-0.1.0-Windows-x64.zip'
if(Test-Path -LiteralPath $zip){Remove-Item -LiteralPath $zip -Force}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Output "ZIP_BUILT=$zip"
if(!$Compiler -and !$ZipOnly){
  $candidates=@(
    (Join-Path $root 'build-tools\inno\ISCC.exe'),
    'C:\Program Files\Inno Setup 7\ISCC.exe',
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
  )
  $Compiler=$candidates | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
}
if($Compiler -and !$ZipOnly){
  & $Compiler (Join-Path $root 'installer\micehole.iss')
  if($LASTEXITCODE -ne 0){throw "Inno compilation failed with $LASTEXITCODE"}
  Write-Output "INSTALLER_BUILT=$(Join-Path $dist 'installer\MiceHole-Universal-0.1.0-Setup.exe')"
}else{Write-Warning 'Only ZIP was created (ZipOnly requested or no Inno compiler found).'}
Get-ChildItem -Path $dist -Filter '*.zip' | ForEach-Object { Get-FileHash $_.FullName -Algorithm SHA256 | Format-List }
Get-ChildItem -Path (Join-Path $dist 'installer') -Filter '*.exe' -ErrorAction SilentlyContinue | ForEach-Object { Get-FileHash $_.FullName -Algorithm SHA256 | Format-List }
