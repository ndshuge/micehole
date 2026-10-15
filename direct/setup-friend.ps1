[CmdletBinding()]
param([string]$Workspace = (Join-Path $env:USERPROFILE 'MiceHoleWorkspace'))
$ErrorActionPreference='Stop'
$base=Split-Path -Parent $MyInvocation.MyCommand.Path
if(-not(Test-Path (Join-Path $base 'mcp\remote\mouse-hole-server.mjs'))){throw 'Incomplete distribution'}
$node=Get-Command node.exe -ErrorAction SilentlyContinue
if(-not $node){Write-Error 'Node.js not found. Install Node.js LTS and rerun setup.';exit 2}
$Workspace=[IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Workspace))
New-Item -ItemType Directory -Force -Path $Workspace|Out-Null
$localCfg=Join-Path $env:LOCALAPPDATA 'MiceHoleV3'
New-Item -ItemType Directory -Force -Path $localCfg|Out-Null
Set-Content -LiteralPath (Join-Path $localCfg 'workspace.txt') -Value $Workspace -Encoding ASCII
$cmd=Join-Path $base 'micehole-direct.cmd'
$env:MOUSE_HOLE_WORKSPACE=$Workspace
$init='{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
$response=$init | & $node.Source (Join-Path $base 'mcp\remote\mouse-hole-server.mjs') | Select-Object -First 1 | ConvertFrom-Json
if($response.result.tools.Count -ne 12){throw ('Expected 12 tools, got '+$response.result.tools.Count)}
$python=Get-Command python.exe -ErrorAction SilentlyContinue
Write-Output "MICEHOLE_SETUP_OK=true"
Write-Output "NODE=$($node.Source)"
Write-Output "WORKSPACE=$Workspace"
Write-Output "LAUNCHER=$cmd"
Write-Output "PYTHON_AVAILABLE=$([bool]$python)"
Write-Output 'CHATGPT_NOTE=Use your own authenticated MCP tunnel and connector. No public high-privilege remote endpoint is configured by setup.'
