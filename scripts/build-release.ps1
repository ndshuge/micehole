param([string]$Compiler="")
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root 'dist\stage'
$dist = Join-Path $root 'dist'
if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
New-Item -ItemType Directory -Force -Path $stage,(Join-Path $stage 'runtime'),(Join-Path $stage 'src'),(Join-Path $stage 'scripts'),(Join-Path $stage 'docs') | Out-Null
Copy-Item (Join-Path $root 'src\*.mjs') (Join-Path $stage 'src')
Copy-Item (Join-Path $root 'scripts\doctor.cmd') (Join-Path $stage 'scripts\doctor.cmd')
foreach($file in @('setup-config.ps1','enable-execution.ps1','disable-execution.ps1','remote-setup.ps1','remote-save-key.ps1','remote-doctor.ps1','remote-run.ps1','remote-control.ps1')){
  Copy-Item (Join-Path $root ('scripts\'+$file)) (Join-Path $stage ('scripts\'+$file))
}
Copy-Item (Join-Path $root 'scripts\micehole.cmd') (Join-Path $stage 'micehole.cmd')
# tunnel-client is not redistributed; each user selects an official binary during setup.
Copy-Item (Join-Path $root 'docs\*.md') (Join-Path $stage 'docs')
Copy-Item (Join-Path $root 'README.md') (Join-Path $stage 'README.md')
$node = 'C:\Program Files\nodejs\node.exe'
if(!(Test-Path -LiteralPath $node)){ throw "Node.js executable missing at $node" }
Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'runtime\node.exe')
$license = Join-Path $root 'installer\NODE-LICENSE.txt'
if(!(Test-Path -LiteralPath $license)){ throw "Node license missing" }
Copy-Item -LiteralPath $license -Destination (Join-Path $stage 'runtime\NODE-LICENSE.txt')
$zip = Join-Path $dist 'MiceHole-Universal-0.1.0-Windows-x64.zip'
if(Test-Path -LiteralPath $zip){Remove-Item -LiteralPath $zip -Force}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Output "ZIP_BUILT=$zip"
if(!$Compiler){
  $candidates=@(
    (Join-Path $root 'build-tools\inno\ISCC.exe'),
    'C:\Program Files\Inno Setup 7\ISCC.exe',
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
  )
  $Compiler=$candidates | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
}
if($Compiler){
  & $Compiler (Join-Path $root 'installer\micehole.iss')
  if($LASTEXITCODE -ne 0){throw "Inno compilation failed with $LASTEXITCODE"}
  Write-Output "INSTALLER_BUILT=$(Join-Path $dist 'installer\MiceHole-Universal-0.1.0-Setup.exe')"
}else{Write-Warning 'No Inno compiler found. ZIP created; installer source ready.'}
Get-ChildItem -Path $dist -Filter '*.zip' | ForEach-Object { Get-FileHash $_.FullName -Algorithm SHA256 | Format-List }
Get-ChildItem -Path (Join-Path $dist 'installer') -Filter '*.exe' -ErrorAction SilentlyContinue | ForEach-Object { Get-FileHash $_.FullName -Algorithm SHA256 | Format-List }
