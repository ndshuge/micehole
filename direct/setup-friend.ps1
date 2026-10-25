[CmdletBinding()]
param([string]$Workspace = '')
$ErrorActionPreference='Stop'
$base=Split-Path -Parent $MyInvocation.MyCommand.Path
if(-not(Test-Path (Join-Path $base 'mcp\remote\mouse-hole-server.mjs'))){throw 'Incomplete distribution'}
$node=Get-Command node.exe -ErrorAction SilentlyContinue
if(-not $node){Write-Error 'Node.js not found. Install Node.js LTS and rerun setup.';exit 2}
# Re-running Setup during manual updates must not reset an existing workspace.
$localCfg = Join-Path $env:LOCALAPPDATA 'MiceHoleV3'
if([string]::IsNullOrWhiteSpace($Workspace)) {
  $savedWorkspace = Join-Path $localCfg 'workspace.txt'
  if(Test-Path -LiteralPath $savedWorkspace -PathType Leaf) {
    $Workspace = (Get-Content -LiteralPath $savedWorkspace -Raw).Trim()
  }
  if([string]::IsNullOrWhiteSpace($Workspace)) {
    $Workspace = Join-Path $env:USERPROFILE 'MiceHoleWorkspace'
  }
}
$Workspace=[IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Workspace))
New-Item -ItemType Directory -Force -Path $Workspace|Out-Null
# Initialize workspace rules once; never replace user-authored AGENTS.md.
$rulesFile = Join-Path $Workspace 'AGENTS.md'
if(-not (Test-Path -LiteralPath $rulesFile)) {
  $templateFile = Join-Path $base 'WORKSPACE-AGENTS.template.md'
  if(-not (Test-Path -LiteralPath $templateFile -PathType Leaf)){throw 'Missing workspace guidance template'}
  Copy-Item -LiteralPath $templateFile -Destination $rulesFile -ErrorAction Stop
  Write-Output 'WORKSPACE_AGENTS=created'
}else{Write-Output 'WORKSPACE_AGENTS=preserved'}
$localCfg=Join-Path $env:LOCALAPPDATA 'MiceHoleV3'
New-Item -ItemType Directory -Force -Path $localCfg|Out-Null
Set-Content -LiteralPath (Join-Path $localCfg 'workspace.txt') -Value $Workspace -Encoding ASCII
$cmd=Join-Path $base 'micehole-direct.cmd'
$env:MOUSE_HOLE_WORKSPACE=$Workspace
. (Join-Path $base 'scripts\mcp-stdio-probe.ps1')
$response=Invoke-MiceHoleToolsProbe -NodePath $node.Source -ServerPath (Join-Path $base 'mcp\remote\mouse-hole-server.mjs')
if($response.result.tools.Count -ne 15){throw ('Expected 15 tools, got '+$response.result.tools.Count)}
$python=Get-Command python.exe -ErrorAction SilentlyContinue
Write-Output "MICEHOLE_SETUP_OK=true"
Write-Output "NODE=$($node.Source)"
Write-Output "WORKSPACE=$Workspace"
Write-Output "LAUNCHER=$cmd"
Write-Output "PYTHON_AVAILABLE=$([bool]$python)"
Write-Output 'CHATGPT_NOTE=Use your own authenticated MCP tunnel and connector. No public high-privilege remote endpoint is configured by setup.'
