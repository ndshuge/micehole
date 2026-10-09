$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$toolDir=Join-Path $root 'build-tools'
$exe=Join-Path $toolDir 'innosetup-7.1.0-x64.exe'
$url='https://github.com/jrsoftware/issrc/releases/download/is-7_1_0/innosetup-7.1.0-x64.exe'
Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
$sig=Get-AuthenticodeSignature -FilePath $exe
Write-Output ("SIGNATURE="+$sig.Status)
Write-Output ("PUBLISHER="+$sig.SignerCertificate.Subject)
Write-Output ("SIZE="+(Get-Item $exe).Length)
if($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Pyrsys') {throw 'Refusing to run downloaded installer with an invalid or unexpected signature.'}
$dest=Join-Path $toolDir 'inno'
$p=Start-Process -FilePath $exe -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',("/DIR="+$dest)) -Wait -PassThru
if($p.ExitCode -ne 0){throw "Inno installation failed: $($p.ExitCode)"}
$compiler=Join-Path $dest 'ISCC.exe'
if(!(Test-Path $compiler)){throw "ISCC not installed at $compiler"}
Write-Output ("COMPILER_READY="+$compiler)
