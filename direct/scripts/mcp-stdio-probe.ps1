# Shared tools/list probe using Node for byte-accurate JSON-RPC.
function Invoke-MiceHoleToolsProbe {
  [CmdletBinding()]
  param([Parameter(Mandatory=$true)][string]$NodePath,[Parameter(Mandatory=$true)][string]$ServerPath)
  $helper=Join-Path $PSScriptRoot 'mcp-probe.mjs'
  $lines=@(& $NodePath $helper $ServerPath 2>&1)
  $code=$LASTEXITCODE
  if($code -ne 0){throw ('MCP probe failed (exit '+$code+'): '+(@($lines | Select-Object -Last 3) -join '; '))}
  $response=@($lines | Where-Object { $_.ToString().TrimStart().StartsWith('{"tools"') } | Select-Object -First 1)
  if($response.Count -ne 1){throw 'MCP probe response absent'}
  $probe=$response[0].ToString() | ConvertFrom-Json
  return [pscustomobject]@{result=[pscustomobject]@{tools=@($probe.tools | ForEach-Object { [pscustomobject]@{name=$_} })}}
}
