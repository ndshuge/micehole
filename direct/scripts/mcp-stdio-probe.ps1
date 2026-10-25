# Shared byte-accurate MCP stdio probe for Windows PowerShell 5.1 and later.
# PowerShell's pipeline may encode strings using the system legacy code page;
# explicit UTF-8 bytes are mandatory for JSON-RPC consumed by Node.js.
function Invoke-MiceHoleToolsProbe {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$NodePath,
    [Parameter(Mandatory=$true)][string]$ServerPath
  )
  if($ServerPath.Contains('"')) {throw 'Invalid server path'}
  $request='{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' + "`n"
  $psi=New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName=$NodePath
  $psi.Arguments='"'+$ServerPath+'"'
  $psi.RedirectStandardInput=$true
  $psi.RedirectStandardOutput=$true
  $psi.RedirectStandardError=$true
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $process=New-Object System.Diagnostics.Process
  $process.StartInfo=$psi
  if(-not $process.Start()){throw 'Unable to start MCP probe process'}
  try {
    $data=[System.Text.Encoding]::UTF8.GetBytes($request)
    $process.StandardInput.BaseStream.Write($data,0,$data.Length)
    $process.StandardInput.BaseStream.Flush()
    # Close the raw byte stream; closing the StreamWriter can append its encoding preamble.
    $process.StandardInput.BaseStream.Close()
    $stdout=$process.StandardOutput.ReadToEnd()
    $stderr=$process.StandardError.ReadToEnd()
    if(-not $process.WaitForExit(10000)){
      try{$process.Kill()}catch{}
      throw 'MCP probe timeout'
    }
    if($process.ExitCode -ne 0) {
      throw ('MCP probe exited '+$process.ExitCode+': '+$stderr.Substring(0,[Math]::Min(500,$stderr.Length)))
    }
    $line=@($stdout -split "\r?\n" | Where-Object { $_.Trim().StartsWith('{"jsonrpc"') } | Select-Object -First 1)
    if($line.Count -ne 1){throw 'No JSON-RPC response from MCP probe'}
    $reply=$line[0] | ConvertFrom-Json
    if($reply.error){throw ('MCP protocol error: '+$reply.error.code)}
    if($null -eq $reply.result -or $null -eq $reply.result.tools){throw 'MCP tools/list payload missing'}
    return $reply
  } finally {
    $process.Dispose()
  }
}
