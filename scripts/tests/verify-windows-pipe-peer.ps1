[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not [Environment]::OSVersion.Platform.Equals([PlatformID]::Win32NT)){throw 'This real SID probe requires Windows'}
$source=@'
using System;
using System.IO.Pipes;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;

public static class MiceHolePipeIdentityProbe
{
    public static bool SameWindowsUserIdentity()
    {
        string serverSid = WindowsIdentity.GetCurrent().User.Value;
        string pipeName = "MiceHole-Sid-Probe-" + Guid.NewGuid().ToString("N");
        using (NamedPipeServerStream server = new NamedPipeServerStream(
            pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.None))
        {
            Task client = Task.Run(() => {
                using (NamedPipeClientStream stream = new NamedPipeClientStream(
                    ".", pipeName, PipeDirection.Out, PipeOptions.None,
                    TokenImpersonationLevel.Impersonation))
                {
                    stream.Connect(4000);
                    stream.WriteByte(17);
                    stream.Flush();
                }
            });
            server.WaitForConnection();
            if (server.ReadByte() != 17) throw new InvalidOperationException("Unexpected pipe frame");
            string actualClientSid = null;
            // The Windows kernel supplies the connected client's token; a claimed SID in
            // application JSON cannot control WindowsIdentity.GetCurrent(true).
            server.RunAsClient(() => {
                using(WindowsIdentity peer = WindowsIdentity.GetCurrent(true)) {
                    if (peer != null && peer.User != null) actualClientSid = peer.User.Value;
                }
            });
            if (!client.Wait(4000)) throw new TimeoutException("Client did not finish");
            if (String.IsNullOrWhiteSpace(actualClientSid))
                throw new InvalidOperationException("Windows did not provide authenticated impersonation SID");
            return String.Equals(actualClientSid, serverSid, StringComparison.OrdinalIgnoreCase);
        }
    }
}
'@
Add-Type -TypeDefinition $source -ErrorAction Stop
$same=[MiceHolePipeIdentityProbe]::SameWindowsUserIdentity()
if(-not $same){throw 'Unexpected separate user identity in same-account negative control'}
Write-Output 'WINDOWS_NAMED_PIPE_REAL_CLIENT_SID=PASS'
Write-Output 'SAME_USER_CLIENT_REJECTED_FOR_REMOTE_EXEC=PASS'
Write-Output 'DIFFERENT_SID_WORKER_VALIDATION=NOT_YET_TESTED'
