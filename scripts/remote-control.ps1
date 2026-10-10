# MiceHole Control: a read-only Windows status panel for personal tunnel onboarding.
# It neither changes live Runtime/Tunnel processes nor stores secrets.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$stateRoot=Join-Path $env:LOCALAPPDATA 'MiceHole\remote'
$window=New-Object System.Windows.Forms.Form
$window.Text='MiceHole Control — Personal Tunnel'
$window.ClientSize=New-Object System.Drawing.Size(640,395)
$window.StartPosition='CenterScreen'
$window.FormBorderStyle='FixedSingle'
$window.MaximizeBox=$false
$window.BackColor=[System.Drawing.Color]::FromArgb(248,250,253)
function Label([string]$text,[int]$x,[int]$y,[int]$w,[int]$h,[int]$size=10){
  $item=New-Object System.Windows.Forms.Label
  $item.Text=$text
  $item.Location=New-Object System.Drawing.Point($x,$y)
  $item.Size=New-Object System.Drawing.Size($w,$h)
  $item.Font=New-Object System.Drawing.Font('Segoe UI',$size)
  $window.Controls.Add($item)
  return $item
}
$null=Label 'MiceHole' 24 20 560 36 22
$null=Label 'Use your ChatGPT allowance to code on your Windows PC' 26 60 584 25 10
$runtime=Label 'Local MCP entry: checking...' 26 114 580 28 11
$tunnel=Label 'Personal Tunnel: checking...' 26 152 580 28 11
$key=Label 'Credential: checking...' 26 190 580 28 11
$help=Label 'Tunnel and plugin setup require your own OpenAI Platform permissions.' 26 240 580 26 9
function Button([string]$name,[int]$x,[int]$y,[int]$w){
  $b=New-Object System.Windows.Forms.Button
  $b.Text=$name
  $b.Location=New-Object System.Drawing.Point($x,$y)
  $b.Size=New-Object System.Drawing.Size($w,34)
  $window.Controls.Add($b)
  return $b
}
$refresh=Button 'Refresh status' 26 290 138
$openTunnel=Button 'Tunnel dashboard' 176 290 138
$openChat=Button 'ChatGPT plugins' 326 290 138
$openDocs=Button 'Usage guide' 476 290 138
$note=Label 'No public ports are opened by this UI. This preview has no automatic restart button.' 26 356 585 24 8
function Refresh-State {
  $settings=Join-Path $stateRoot 'settings.json'
  $keyFile=Join-Path $stateRoot 'runtime-key.dpapi'
  if(-not(Test-Path -LiteralPath $settings)){ $runtime.Text='Local MCP entry: not configured';$tunnel.Text='Personal Tunnel: setup required';$key.Text='Credential: not configured';return }
  try{
    $cfg=Get-Content -LiteralPath $settings -Raw|ConvertFrom-Json
    $runtime.Text='Local MCP entry: '+$(if(Test-Path -LiteralPath $cfg.local_mcp_entry){'present'}else{'missing'})
    $key.Text='Credential: '+$(if(Test-Path -LiteralPath $keyFile){'stored securely for this user'}else{'not set'})
    try{
      $url='http://127.0.0.1:'+$cfg.health_port+'/readyz'
      $res=Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      $tunnel.Text='Personal Tunnel: '+$(if($res.StatusCode -eq 200){'connected / ready'}else{'not ready'})
    }catch{ $tunnel.Text='Personal Tunnel: stopped, unreachable, or unhealthy' }
  }catch{$runtime.Text='Local MCP entry: configuration error';$tunnel.Text='Personal Tunnel: unknown'}
}
$refresh.Add_Click({Refresh-State})
$openTunnel.Add_Click({
  $settings=Join-Path $stateRoot 'settings.json'
  if(-not(Test-Path -LiteralPath $settings)){[System.Windows.Forms.MessageBox]::Show('Set up a personal Tunnel first.','MiceHole');return}
  try{$cfg=Get-Content -LiteralPath $settings -Raw|ConvertFrom-Json;Start-Process ('http://127.0.0.1:'+$cfg.health_port+'/ui')}
  catch{[System.Windows.Forms.MessageBox]::Show('Unable to open local Tunnel UI.','MiceHole')}
})
$openChat.Add_Click({Start-Process 'https://chatgpt.com/'})
$openDocs.Add_Click({
  $guide=Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\CHATGPT-QUICKSTART.md'
  if(Test-Path -LiteralPath $guide){Start-Process $guide}
})
Refresh-State
[void]$window.ShowDialog()
