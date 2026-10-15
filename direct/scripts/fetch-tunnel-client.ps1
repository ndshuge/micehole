[CmdletBinding()]
param([string]$Destination='')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=Split-Path -Parent $PSScriptRoot
if(-not $Destination){$Destination=Join-Path $root 'build-tools\vendor\tunnel'}
$version='v0.0.15'
$asset='tunnel-client-v0.0.15-windows-amd64.zip'
$expected='3B53133A1E24D43F63088D843860CB1701A4C3ED6390DE2E19F69089E43BDDC1'
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$zip=Join-Path $Destination $asset
if(-not(Test-Path -LiteralPath $zip)){
  $gh=Get-Command gh.exe -ErrorAction SilentlyContinue
  if($gh){
    & $gh.Source release download $version --repo openai/tunnel-client --pattern $asset --dir $Destination
    if($LASTEXITCODE -ne 0){throw 'Official tunnel-client GitHub download failed.'}
  }else{
    $url='https://github.com/openai/tunnel-client/releases/download/'+$version+'/'+$asset
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  }
}
$actual=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToUpperInvariant()
if($actual -cne $expected){throw "Tunnel-client archive checksum mismatch. Expected $expected, got $actual"}
$expanded=Join-Path $Destination 'expanded'
New-Item -ItemType Directory -Force -Path $expanded | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $expanded -Force
foreach($file in @('tunnel-client.exe','LICENSE','NOTICE','tunnel-client-v0.0.15-windows-amd64-licenses.txt')){
  if(-not(Test-Path -LiteralPath (Join-Path $expanded $file) -PathType Leaf)){throw ('Official asset missing: '+$file)}
}
$versionInfo=& (Join-Path $expanded 'tunnel-client.exe') --version
if($LASTEXITCODE -ne 0 -or ($versionInfo -notmatch '0\.0\.15')){throw 'Unexpected tunnel-client version'}
Write-Output "OFFICIAL_TUNNEL_CLIENT_VERIFIED=$version"
Write-Output "SHA256=$actual"
Write-Output 'SOURCE=https://github.com/openai/tunnel-client/releases/tag/v0.0.15'
