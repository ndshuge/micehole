[CmdletBinding()]
param([switch]$Json)
$ErrorActionPreference='Stop'
$base=Split-Path -Parent $PSScriptRoot
$workspaceFile=Join-Path $env:LOCALAPPDATA 'MiceHoleV3\workspace.txt'
$node=Get-Command node.exe -ErrorAction SilentlyContinue
$python=Get-Command python.exe -ErrorAction SilentlyContinue
$ws=if(Test-Path $workspaceFile){(Get-Content $workspaceFile -Raw).Trim()}else{Join-Path $env:USERPROFILE 'MiceHoleWorkspace'}
$tools=@()
if($node){
  $env:MOUSE_HOLE_WORKSPACE=$ws
  if(-not(Test-Path $ws)){New-Item -ItemType Directory -Force $ws|Out-Null}
  . (Join-Path $PSScriptRoot 'mcp-stdio-probe.ps1')
  try{
    $response=Invoke-MiceHoleToolsProbe -NodePath $node.Source -ServerPath (Join-Path $base 'mcp\remote\mouse-hole-server.mjs')
    $tools=@($response.result.tools | ForEach-Object name)
  }catch{
    $probeError=$_.Exception.Message
  }
}
$report=[ordered]@{
  installer_root=$base
  workspace=$ws
  node_available=[bool]$node
  python_available=[bool]$python
  tools_count=$tools.Count
  desired_tool_count=15
  specialized_tools_present=(@($tools|Where-Object{$_ -match 'godot|blender|comfyui'}).Count -eq 3)
  tunnel_client_available=(Test-Path (Join-Path $base 'tunnel-client\tunnel-client.exe'))
  personal_tunnel_id_configured=(Test-Path (Join-Path $env:LOCALAPPDATA 'MiceHoleV3\remote\settings.json'))
  local_ready=([bool]$node -and $tools.Count -eq 15)
  remote_high_privilege_verified=$false
}
[pscustomobject]$report|ConvertTo-Json -Depth 3
if(-not $report.local_ready){exit 1}
