# Optional, read-only network diagnosis for the owner's own Windows computer.
# Never reads subscriptions, tunnel credentials, or modifies the system proxy.
[CmdletBinding()]
param(
  [string]$ProxyUri = '',
  [ValidateRange(2,30)][int]$TimeoutSeconds = 8,
  [ValidateRange(0,65535)][int]$TunnelHealthPort = 0,
  [switch]$Json
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$report = [ordered]@{
  tool = 'MiceHole V3 network doctor'
  mode = if($ProxyUri){'explicit_proxy'}else{'direct_no_proxy'}
  local_proxy = 'not_requested'
  reference_https = 'not_checked'
  openai_api = 'not_checked'
  tunnel_local = 'not_checked'
  remote_chatgpt_mcp = 'not_verified'
  subscription_quota = 'unknown_check_provider'
  classification = 'unknown'
  next_step = ''
}
function Test-LocalTcpPort([string]$HostName,[int]$Port){
  $tcp = New-Object System.Net.Sockets.TcpClient
  try{
    $result = $tcp.BeginConnect($HostName,$Port,$null,$null)
    if(-not $result.AsyncWaitHandle.WaitOne(1500,$false)){return $false}
    $tcp.EndConnect($result)
    return $tcp.Connected
  }catch{return $false}
  finally{$tcp.Dispose()}
}
function Test-Http([string]$Url,[object]$Proxy,[int]$Timeout){
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $false
  # Explicit proxy only. Windows system proxy settings do not decide this test.
  $handler.UseProxy = ($null -ne $Proxy)
  if($null -ne $Proxy){$handler.Proxy = $Proxy}
  $client = New-Object System.Net.Http.HttpClient -ArgumentList $handler
  $client.Timeout = [TimeSpan]::FromSeconds($Timeout)
  try {
    $reply = $client.GetAsync($Url).GetAwaiter().GetResult()
    return 'http_' + [int]$reply.StatusCode
  } catch {
    $root = $_.Exception
    while($root.InnerException){$root = $root.InnerException}
    if($root -is [System.Threading.Tasks.TaskCanceledException]) {return 'timeout'}
    if($root -is [System.Net.Sockets.SocketException]) {return 'socket_error'}
    return 'request_failed'
  } finally{$client.Dispose();$handler.Dispose()}
}
try {
  # The only accepted explicit proxy is an HTTP endpoint on this computer.
  $proxy = $null
  if($ProxyUri){
    $uri = $null
    if(-not [Uri]::TryCreate($ProxyUri,[UriKind]::Absolute,[ref]$uri) -or
       $uri.Scheme -ne 'http' -or
       ($uri.Host -notin @('127.0.0.1','localhost','::1')) -or
       $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
       $uri.AbsolutePath -ne '/'){
      throw 'ProxyUri must be a credential-free localhost HTTP proxy, e.g. http://127.0.0.1:7897'
    }
    if(-not (Test-LocalTcpPort $uri.Host $uri.Port)){
      $report.local_proxy = 'port_closed'
      $report.classification = 'local_proxy_not_listening'
      $report.next_step = 'Start your proxy client or check its local HTTP port. No Tunnel restart is needed yet.'
    }else{
      $report.local_proxy = 'listening'
      $proxy = New-Object System.Net.WebProxy -ArgumentList $ProxyUri
    }
  }
  if($report.classification -eq 'unknown'){
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $report.reference_https = Test-Http 'https://www.gstatic.com/generate_204' $proxy $TimeoutSeconds
    $report.openai_api = Test-Http 'https://api.openai.com/v1/models' $proxy $TimeoutSeconds
    $rOK = $report.reference_https -in @('http_204','http_200')
    # Unauthenticated API probe normally returns HTTP 401: proves endpoint HTTP response only.
    $aOK = $report.openai_api -in @('http_401','http_200')
    if($rOK -and $aOK){
      $report.classification = 'network_probe_passed'
      $report.next_step = 'Network endpoint reachable; if MCP still fails, check Tunnel configuration and ChatGPT connector.'
    }elseif($rOK -and -not $aOK){
      $report.classification = 'openai_path_or_policy_issue'
      $report.next_step = 'Generic HTTPS works but OpenAI API does not. Check exit node, provider quota/account, region/policy and Tunnel logs.'
    }else{
      $report.classification = 'proxy_or_upstream_unhealthy'
      $report.next_step = 'Reference HTTPS failed. Check proxy routing, node connectivity and subscription status before restarting MiceHole.'
    }
  }
  if($TunnelHealthPort -gt 0){
    $report.tunnel_local = if(Test-LocalTcpPort '127.0.0.1' $TunnelHealthPort){'port_listening_not_e2e_verified'}else{'port_closed'}
  }
}catch{
  $report.classification = 'invalid_configuration_or_check_error'
  $report.next_step = $_.Exception.Message
}
if($Json){$report | ConvertTo-Json -Depth 4 -Compress}
else {
  Write-Output 'MiceHole network check (read-only; no secrets collected)'
  $report.GetEnumerator() | ForEach-Object {Write-Output ('{0}: {1}' -f $_.Key,$_.Value)}
}
if($report.classification -ne 'network_probe_passed'){exit 1}
